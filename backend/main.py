import threading
from pathlib import Path
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.routing import WebSocketRoute

from backend.config import HLS_DIR, RECORDINGS_DIR, SNAPSHOTS_DIR, load_settings, build_rtsp_url
from backend.routers import cameras, stream, ptz, recordings, snapshots, auth
from backend.ws.ptz_ws import ptz_websocket
from backend.ws.mjpeg_ws import mjpeg_websocket
from backend.services.stream_manager import stream_manager
from backend.services.recording_service import recording_service
from backend.services.watchdog import watchdog
from backend.services.mjpeg_manager import mjpeg_manager
from backend.auth import get_current_user_http

logger = logging.getLogger("main")

FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"


def _autostart_recording():
    """Start continuous DVR recording for every enabled camera."""
    try:
        killed = recording_service.kill_orphans()
        if killed:
            logger.info("Killed %d orphan ffmpeg processes from previous run", killed)
    except Exception as e:
        logger.warning("Failed to kill orphan ffmpeg processes: %s", e)

    try:
        restored = recording_service.restore_all_backups()
        if restored:
            logger.info("Restored %d backup files to .mp4 recordings", restored)
    except Exception as e:
        logger.warning("Backup restoration failed: %s", e)

    try:
        migrated = recording_service.migrate_flat_segments()
        if migrated:
            logger.info("Migrated %d flat segments into date folders", migrated)
    except Exception as e:
        logger.warning("Segment migration failed: %s", e)

    try:
        settings = load_settings()
        cams = settings.get("cameras", [])
        started = 0
        for cam in cams:
            if not cam.get("enabled", True):
                continue
            cid = cam.get("id")
            if not cid:
                continue
            if recording_service.is_recording(cid):
                continue
            cam_dir = RECORDINGS_DIR / f"cam_{cid}"
            if (cam_dir / "_pause").exists():
                continue
            url = build_rtsp_url(cam)
            result = recording_service.start(cid, url, cam.get("name", f"cam{cid}"))
            if result.get("success"):
                started += 1
                logger.info("Autostart recording for camera %s (%s)", cid, cam.get("name", "?"))
            else:
                logger.warning("Autostart failed for camera %s: %s", cid, result.get("error"))
        recording_service._start_cleanup_loop()
        threading.Thread(
            target=recording_service.finalize_completed_segments,
            daemon=True,
            name="dvr-startup-finalize",
        ).start()
        logger.info("Autostart recording: %d/%d cameras", started, len(cams))
    except Exception as e:
        logger.error("Autostart recording error: %s", e)


def _autostart_onvif():
    settings = load_settings()
    cams = settings.get("cameras", [])

    def _connect_all():
        from backend.ws.ptz_ws import _get_onvif
        for cam in cams:
            if not cam.get("enabled", True):
                continue
            cid = cam.get("id")
            if not cid:
                continue
            try:
                onvif = _get_onvif(cid)
                if not onvif.is_connected:
                    result = onvif.connect(cam["ip"], cam["user"], cam["password"])
                    if result.get("success"):
                        logger.info("ONVIF pre-connected for camera %s (%s)", cid, cam.get("name", "?"))
                    else:
                        logger.debug("ONVIF pre-connect skipped for camera %s: %s", cid, result.get("error"))
            except Exception as e:
                logger.debug("ONVIF pre-connect error for camera %s: %s", cid, e)

    threading.Thread(target=_connect_all, daemon=True, name="onvif-autostart").start()


@asynccontextmanager
async def lifespan(app: FastAPI):
    watchdog.set_services(stream_manager, recording_service)
    _autostart_onvif()
    _autostart_recording()
    watchdog.start()
    yield
    watchdog.stop()
    stream_manager.stop_all()
    recording_service.stop_all()
    await mjpeg_manager.shutdown()


app = FastAPI(title="AGARCORP DE VENEZUELA C.A", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(cameras.router)
app.include_router(stream.router)
app.include_router(ptz.router)
app.include_router(recordings.router)
app.include_router(snapshots.router)

app.mount("/hls", StaticFiles(directory=str(HLS_DIR)), name="hls")
app.mount("/recordings/files", StaticFiles(directory=str(RECORDINGS_DIR)), name="recordings_files")
app.mount("/snapshots/files", StaticFiles(directory=str(SNAPSHOTS_DIR)), name="snapshots_files")


async def ws_ptz_handler(websocket):
    camera_id = websocket.path_params["camera_id"]
    await ptz_websocket(websocket, camera_id)


async def ws_mjpeg_handler(websocket):
    camera_id = websocket.path_params["camera_id"]
    await mjpeg_websocket(websocket, camera_id)


app.router.routes.append(WebSocketRoute("/ws/ptz/{camera_id}", ws_ptz_handler))
app.router.routes.append(WebSocketRoute("/ws/mjpeg/{camera_id}", ws_mjpeg_handler))


@app.get("/api/health")
def health(request: Request):
    user = get_current_user_http(request)
    streams = stream_manager.status()
    watchdog_statuses = watchdog.get_statuses()
    mjpeg_statuses = mjpeg_manager.status()
    if user["role"] == "traileradv":
        allowed = set(user.get("allowed_camera_ids", []))
        streams = [s for s in streams if s.get("camera_id") in allowed]
        watchdog_statuses = [w for w in watchdog_statuses if w.get("camera_id") in allowed]
        mjpeg_statuses = [m for m in mjpeg_statuses if m.get("camera_id") in allowed]
    return {"status": "ok", "streams": streams, "watchdog": watchdog_statuses, "mjpeg": mjpeg_statuses}


if FRONTEND_DIR.exists():
    class SPAIndex:
        def __init__(self, app):
            self.app = app

        async def __call__(self, scope, receive, send):
            if scope["type"] != "http":
                return await self.app(scope, receive, send)
            path = scope["path"]
            if path.startswith("/api/") or path.startswith("/ws/") or path.startswith("/hls/") or path.startswith("/recordings/") or path.startswith("/snapshots/") or path.startswith("/assets/") or path == "/favicon.svg":
                return await self.app(scope, receive, send)
            from starlette.responses import Response
            index_file = FRONTEND_DIR / "index.html"
            try:
                content = index_file.read_bytes()
            except OSError:
                content = b"<!doctype html><html><body>Frontend not built</body></html>"
            resp = Response(content=content, media_type="text/html")
            return await resp(scope, receive, send)

    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="static_assets")
    app.add_middleware(SPAIndex)
