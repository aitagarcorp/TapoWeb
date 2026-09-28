import asyncio
import logging
import shutil
import time
from dataclasses import dataclass, field
from fastapi import WebSocket

from backend.config import build_mjpeg_rtsp_url, get_camera_by_id

logger = logging.getLogger("mjpeg_manager")

GRACE_PERIOD = 10.0
QUEUE_MAXSIZE = 1
READ_CHUNK = 32768
BUF_LIMIT = 262144
MIN_FRAME = 256
SEND_TIMEOUT = 5.0
SUBSCRIBER_TIMEOUT = 20.0
HEARTBEAT_INTERVAL = 10.0
SIGNAL_AGE_SECONDS = 12.0
RESTART_BACKOFF_INITIAL = 2.0
RESTART_BACKOFF_MAX = 60.0


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _cmd(rtsp_url: str) -> list[str]:
    return [
        _ffmpeg(), "-y",
        "-rtsp_transport", "tcp",
        "-timeout", "15000000",
        "-fflags", "+nobuffer+flush_packets+genpts",
        "-flags", "low_delay",
        "-probesize", "500000",
        "-analyzeduration", "500000",
        "-threads", "1",
        "-i", rtsp_url,
        "-an",
        "-vf", "scale=640:-2,fps=10",
        "-c:v", "mjpeg",
        "-q:v", "7",
        "-flush_packets", "1",
        "-f", "image2pipe",
        "pipe:1",
    ]


@dataclass
class _CameraStream:
    process: asyncio.subprocess.Process | None = None
    runner_task: asyncio.Task | None = None
    subscribers: dict[WebSocket, asyncio.Queue] = field(default_factory=dict)
    last_frame: bytes | None = None
    last_frame_at: float = 0.0
    dvr_frame_at: float = 0.0
    started_at: float = 0.0
    grace_task: asyncio.Task | None = None


class MjpegStreamManager:
    def __init__(self):
        self._streams: dict[str, _CameraStream] = {}
        self._global_lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def _get_or_create_stream(self, camera_id: str) -> _CameraStream:
        stream = self._streams.get(camera_id)
        if stream is None:
            stream = _CameraStream()
            self._streams[camera_id] = stream
        return stream

    def push_frame_threadsafe(self, camera_id: str, jpg: bytes):
        """Deliver MJPEG frame produced by recording_service's stdout pipe."""
        now = time.monotonic()
        stream = self._get_or_create_stream(camera_id)
        stream.last_frame = jpg
        stream.last_frame_at = now
        stream.dvr_frame_at = now
        loop = self._loop
        if loop is not None and not loop.is_closed() and stream.subscribers:
            try:
                loop.call_soon_threadsafe(self._deliver_to_subscribers, stream, jpg)
            except RuntimeError:
                pass

    def _deliver_to_subscribers(self, stream: _CameraStream, jpg: bytes):
        for q in list(stream.subscribers.values()):
            while not q.empty():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    break
            try:
                q.put_nowait(jpg)
            except asyncio.QueueFull:
                pass

    async def subscribe(self, camera_id: str, ws: WebSocket):
        self._loop = asyncio.get_running_loop()
        async with self._global_lock:
            stream = self._get_or_create_stream(camera_id)

            if stream.grace_task:
                stream.grace_task.cancel()
                stream.grace_task = None

            if stream.runner_task is None or stream.runner_task.done():
                stream.runner_task = asyncio.create_task(self._runner(camera_id, stream))

            queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
            stream.subscribers[ws] = queue

        if stream.last_frame:
            try:
                await ws.send_bytes(stream.last_frame)
            except Exception:
                await self._unsubscribe(camera_id, ws, stream)
                return

        ws_closed = False

        async def heartbeat():
            nonlocal ws_closed
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                try:
                    await ws.send_text("\x00")
                except Exception:
                    ws_closed = True
                    try:
                        queue.put_nowait(None)
                    except asyncio.QueueFull:
                        pass
                    return

        hb_task = asyncio.create_task(heartbeat())
        try:
            while True:
                try:
                    frame = await asyncio.wait_for(queue.get(), timeout=SUBSCRIBER_TIMEOUT)
                except asyncio.TimeoutError:
                    if ws_closed or self._is_stream_dead(camera_id):
                        break
                    continue
                if frame is None or ws_closed:
                    break
                try:
                    await asyncio.wait_for(ws.send_bytes(frame), timeout=SEND_TIMEOUT)
                except (asyncio.TimeoutError, Exception):
                    break
        except Exception:
            pass
        finally:
            hb_task.cancel()
            try:
                await hb_task
            except (asyncio.CancelledError, Exception):
                pass
            await self._unsubscribe(camera_id, ws, stream)

    def _is_stream_dead(self, camera_id: str) -> bool:
        stream = self._streams.get(camera_id)
        if stream is None:
            return True
        return stream.runner_task is None or stream.runner_task.done()

    async def _unsubscribe(self, camera_id: str, ws: WebSocket, stream: _CameraStream):
        async with self._global_lock:
            stream.subscribers.pop(ws, None)
            if not stream.subscribers:
                stream.grace_task = asyncio.create_task(self._grace_period(camera_id, stream))

    async def _grace_period(self, camera_id: str, stream: _CameraStream):
        try:
            await asyncio.sleep(GRACE_PERIOD)
            async with self._global_lock:
                if not stream.subscribers:
                    await self._stop_stream(camera_id, stream)
        except asyncio.CancelledError:
            pass

    def _dvr_pipe_active(self, camera_id: str, stream: _CameraStream) -> bool:
        from backend.services.recording_service import recording_service
        if not recording_service.is_recording(camera_id):
            return False
        if stream.dvr_frame_at > 0 and (time.monotonic() - stream.dvr_frame_at) < 10.0:
            return True
        return stream.dvr_frame_at == 0.0

    async def _runner(self, camera_id: str, stream: _CameraStream):
        backoff = RESTART_BACKOFF_INITIAL
        try:
            while True:
                async with self._global_lock:
                    if not stream.subscribers:
                        return
                    cam = get_camera_by_id(camera_id)
                    if cam is None:
                        return
                    rtsp_url = build_mjpeg_rtsp_url(cam)
                    stream.started_at = time.monotonic()

                if self._dvr_pipe_active(camera_id, stream):
                    await asyncio.sleep(1.0)
                    continue

                try:
                    proc = await asyncio.create_subprocess_exec(
                        *_cmd(rtsp_url),
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.DEVNULL,
                        stdin=asyncio.subprocess.DEVNULL,
                    )
                except Exception as e:
                    logger.error("Failed to start FFmpeg for camera %s: %s", camera_id, e)
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, RESTART_BACKOFF_MAX)
                    continue

                async with self._global_lock:
                    stream.process = proc

                produced = await self._pump(camera_id, stream, proc)

                if proc.returncode is None:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                    try:
                        await proc.wait()
                    except Exception:
                        pass

                async with self._global_lock:
                    stream.process = None
                    if not stream.subscribers:
                        return

                if produced:
                    backoff = RESTART_BACKOFF_INITIAL
                else:
                    logger.warning(
                        "Camera %s MJPEG FFmpeg produced no frames, backing off %.1fs",
                        camera_id, backoff,
                    )
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, RESTART_BACKOFF_MAX)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("MJPEG runner for camera %s crashed: %s", camera_id, e)

    async def _pump(self, camera_id: str, stream: _CameraStream, proc: asyncio.subprocess.Process) -> bool:
        buf = b""
        produced = False
        try:
            while True:
                if stream.dvr_frame_at > 0 and (time.monotonic() - stream.dvr_frame_at) < 4.0:
                    break
                chunk = await proc.stdout.read(READ_CHUNK)
                if not chunk:
                    break
                buf += chunk

                if len(buf) > BUF_LIMIT:
                    last_soi = buf.rfind(b"\xff\xd8")
                    if last_soi > 0:
                        buf = buf[last_soi:]

                latest_jpg: bytes | None = None
                while True:
                    soi = buf.find(b"\xff\xd8")
                    if soi == -1:
                        buf = b""
                        break
                    eoi = buf.find(b"\xff\xd9", soi + 2)
                    if eoi == -1:
                        buf = buf[soi:]
                        break
                    jpg = buf[soi:eoi + 2]
                    buf = buf[eoi + 2:]
                    if len(jpg) >= MIN_FRAME:
                        latest_jpg = jpg

                if latest_jpg is not None:
                    stream.last_frame = latest_jpg
                    stream.last_frame_at = time.monotonic()
                    produced = True
                    self._deliver_to_subscribers(stream, latest_jpg)
        except Exception:
            pass
        return produced

    async def _stop_stream(self, camera_id: str, stream: _CameraStream):
        if stream.runner_task:
            stream.runner_task.cancel()
            try:
                await stream.runner_task
            except (asyncio.CancelledError, Exception):
                pass
            stream.runner_task = None
        if stream.process and stream.process.returncode is None:
            try:
                stream.process.kill()
            except Exception:
                pass
            try:
                await stream.process.wait()
            except Exception:
                pass
        stream.process = None

    async def shutdown(self):
        async with self._global_lock:
            for cid, stream in list(self._streams.items()):
                await self._stop_stream(cid, stream)

    def status(self) -> list[dict]:
        now = time.monotonic()
        result = []
        for cid, stream in self._streams.items():
            dvr_recent = stream.dvr_frame_at > 0 and (now - stream.dvr_frame_at) < SIGNAL_AGE_SECONDS
            runner_alive = (stream.runner_task is not None and not stream.runner_task.done()) or dvr_recent
            has_signal = (
                stream.last_frame_at > 0
                and (now - stream.last_frame_at) < SIGNAL_AGE_SECONDS
            )
            reconnecting = runner_alive and not has_signal
            last_frame_age = (now - stream.last_frame_at) if stream.last_frame_at > 0 else None
            result.append({
                "camera_id": cid,
                "active": runner_alive,
                "subscribers": len(stream.subscribers),
                "pid": stream.process.pid if stream.process else None,
                "has_signal": has_signal,
                "reconnecting": reconnecting,
                "last_frame_age_sec": last_frame_age,
                "source": "dvr_pipe" if dvr_recent else "rtsp",
            })
        return result


mjpeg_manager = MjpegStreamManager()