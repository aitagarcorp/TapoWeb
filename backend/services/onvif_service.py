import threading
import time
import logging
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger("onvif_service")

_CONNECT_TIMEOUT = 12
_PTZ_TIMEOUT = 8
_PATCHED_ONVIF = False


def _ensure_fast_onvif():
    """Patch ONVIFCamera.update_xaddrs once so it does not call
    create_events_service() / CreatePullPointSubscription(), which hangs
    until timeout on Tapo C200/C500 cameras."""
    global _PATCHED_ONVIF
    if _PATCHED_ONVIF:
        return
    try:
        import onvif.client
        from onvif.definition import SERVICES

        def _fast_update_xaddrs(self):
            self.dt_diff = None
            self.devicemgmt = self.create_devicemgmt_service()
            self.xaddrs = {}
            capabilities = self.devicemgmt.GetCapabilities({"Category": "All"})
            for name in capabilities:
                capability = capabilities[name]
                try:
                    if name.lower() in SERVICES and capability is not None:
                        ns = SERVICES[name.lower()]["ns"]
                        self.xaddrs[ns] = capability["XAddr"]
                except Exception:
                    pass

        onvif.client.ONVIFCamera.update_xaddrs = _fast_update_xaddrs
        _PATCHED_ONVIF = True
    except Exception as e:
        logger.warning("Could not patch ONVIFCamera.update_xaddrs: %s", e)


class OnvifService:
    def __init__(self):
        self._cam = None
        self._ptz = None
        self._media = None
        self._profile_token: str | None = None
        self._lock = threading.Lock()
        self._connect_lock = threading.Lock()
        self._connected = False
        self._patrol_stop: threading.Event | None = None
        self._cruise_stop: threading.Event | None = None
        self._light_on = False
        self.cruise_mode: str | None = None  # 'h' | 'v' | 'patrol' | 'sweep' | None
        self.patrol_interval: int = 10
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="onvif-ptz")
        self._transport = None

        # Latest pending move command — allows coalescing rapid move bursts
        # without letting a quick stop() overwrite an un-dispatched move().
        self._pending_move: tuple[float, float] | None = None
        self._stop_requested: bool = False
        self._move_event = threading.Event()
        self._move_thread: threading.Thread | None = None
        self._move_stop = threading.Event()
        self.last_latency_ms: float = 0.0

    @property
    def is_connected(self) -> bool:
        return self._connected

    def _require(self):
        if not self._connected or not self._ptz or not self._profile_token:
            raise RuntimeError("ONVIF not connected")

    def connect(self, ip: str, user: str, password: str, port: int = 2020, max_retries: int = 1) -> dict:
        with self._connect_lock:
            if self._connected and self._ptz is not None:
                return {"success": True, "profile_token": self._profile_token, "presets": []}
            _ensure_fast_onvif()
            last_err = None
            for attempt in range(max_retries):
                try:
                    from onvif import ONVIFCamera
                    from zeep import Transport
                    # Use a SINGLE Transport instance across devicemgmt and ptz
                    # so we never open competing HTTP sockets to port 2020.
                    self._transport = Transport(timeout=_CONNECT_TIMEOUT, operation_timeout=_CONNECT_TIMEOUT)
                    self._cam = ONVIFCamera(ip, port, user, password, transport=self._transport)
                    self._cam.host = ip
                    for ns in list(self._cam.xaddrs.keys()):
                        old = self._cam.xaddrs[ns]
                        if old:
                            self._cam.xaddrs[ns] = old.replace(old.split("://")[1].split(":")[0], ip)
                    # Tapo C200/C500 always use profile_1; avoid downloading 15KB GetProfiles() XML over slow VPN links
                    self._profile_token = "profile_1"
                    self._ptz = self._cam.create_ptz_service()
                    self._transport.operation_timeout = _PTZ_TIMEOUT
                    self._connected = True
                    if self._move_thread is None or not self._move_thread.is_alive():
                        self._move_stop.clear()
                        self._move_thread = threading.Thread(
                            target=self._move_dispatcher,
                            daemon=True,
                            name=f"onvif-move-{ip}",
                        )
                        self._move_thread.start()
                    return {"success": True, "profile_token": self._profile_token, "presets": []}
                except Exception as e:
                    last_err = e
                    if attempt < max_retries - 1:
                        time.sleep(1 + attempt)
            self._connected = False
            return {"success": False, "error": str(last_err)}

    def _move_dispatcher(self):
        last_move_end = 0.0
        while not self._move_stop.is_set():
            triggered = self._move_event.wait(timeout=0.5)
            if not triggered:
                continue
            self._move_event.clear()
            if not self._ptz or not self._profile_token:
                continue

            # 1. Always dispatch any pending directional move first
            cmd = self._pending_move
            if cmd is not None:
                self._pending_move = None
                pan, tilt = cmd
                with self._lock:
                    t0 = time.perf_counter()
                    try:
                        self._ptz.ContinuousMove({
                            "ProfileToken": self._profile_token,
                            "Velocity": {"PanTilt": {"x": float(pan), "y": float(tilt)}},
                        })
                        self.last_latency_ms = round((time.perf_counter() - t0) * 1000, 1)
                        last_move_end = time.monotonic()
                    except Exception as e:
                        logger.warning("PTZ ContinuousMove error: %s", e)

            # 2. If stop was requested (and no newer move arrived), ensure minimum step duration then Stop
            if self._stop_requested and self._pending_move is None:
                self._stop_requested = False
                elapsed = time.monotonic() - last_move_end
                if 0 <= elapsed < 0.18:
                    time.sleep(0.18 - elapsed)
                if self._pending_move is not None:
                    # A new move arrived during the step window; skip stop
                    self._move_event.set()
                    continue
                with self._lock:
                    t0 = time.perf_counter()
                    try:
                        self._ptz.Stop({
                            "ProfileToken": self._profile_token,
                            "PanTilt": True,
                            "Zoom": True,
                        })
                        self.last_latency_ms = round((time.perf_counter() - t0) * 1000, 1)
                    except Exception as e:
                        logger.warning("PTZ Stop error: %s", e)

    def continuous_move(self, pan: float, tilt: float) -> bool:
        if not self._connected or not self._ptz or not self._profile_token:
            return False
        if self._cruise_stop:
            self._cruise_stop.set()
            self._cruise_stop = None
        if self._patrol_stop:
            self._patrol_stop.set()
            self._patrol_stop = None
        self.cruise_mode = None
        self._pending_move = (pan, tilt)
        self._stop_requested = False
        self._move_event.set()
        return True

    def stop(self) -> bool:
        if not self._connected or not self._ptz or not self._profile_token:
            return False
        self._stop_requested = True
        self._move_event.set()
        return True

    def stop_immediate(self) -> bool:
        """Synchronous stop — used by patrol/cruise where timing matters."""
        if not self._connected or not self._ptz or not self._profile_token:
            return False
        self._pending_move = None
        self._stop_requested = False
        with self._lock:
            t0 = time.perf_counter()
            try:
                self._ptz.Stop({
                    "ProfileToken": self._profile_token,
                    "PanTilt": True,
                    "Zoom": True,
                })
                self.last_latency_ms = round((time.perf_counter() - t0) * 1000, 1)
                return True
            except Exception:
                return False

    def move_immediate(self, pan: float, tilt: float) -> bool:
        """Synchronous move — used by patrol/cruise threads so step timers start after SOAP completes."""
        if not self._connected or not self._ptz or not self._profile_token:
            return False
        with self._lock:
            t0 = time.perf_counter()
            try:
                self._ptz.ContinuousMove({
                    "ProfileToken": self._profile_token,
                    "Velocity": {"PanTilt": {"x": float(pan), "y": float(tilt)}},
                })
                self.last_latency_ms = round((time.perf_counter() - t0) * 1000, 1)
                return True
            except Exception as e:
                logger.warning("PTZ move_immediate error: %s", e)
                return False

    def set_led(self, enabled: bool) -> bool:
        self._require()
        with self._lock:
            try:
                self._ptz.SendAuxiliaryCommand({
                    "ProfileToken": self._profile_token,
                    "AuxiliaryData": "LEDOn" if enabled else "LEDOff",
                })
                self._light_on = enabled
                return True
            except Exception:
                return False

    def get_presets(self) -> list[dict]:
        self._require()
        with self._lock:
            try:
                raw = self._ptz.GetPresets({"ProfileToken": self._profile_token})
                return [{"token": str(p.token) if p.token else "", "name": str(p.Name) if p.Name else "Sin nombre"} for p in raw]
            except Exception:
                return []

    def set_preset(self, name: str) -> str:
        self._require()
        with self._lock:
            t0 = time.perf_counter()
            resp = self._ptz.SetPreset({"ProfileToken": self._profile_token, "PresetName": str(name)})
            self.last_latency_ms = round((time.perf_counter() - t0) * 1000, 1)
            return str(resp)

    def _goto_preset_raw(self, preset_token: str) -> bool:
        self._require()
        with self._lock:
            t0 = time.perf_counter()
            try:
                self._ptz.GotoPreset({
                    "ProfileToken": self._profile_token,
                    "PresetToken": str(preset_token),
                    "Speed": {"PanTilt": {"x": 0.5, "y": 0.5}},
                })
                self.last_latency_ms = round((time.perf_counter() - t0) * 1000, 1)
                return True
            except Exception:
                return False

    def goto_preset(self, preset_token: str) -> bool:
        if self._cruise_stop:
            self._cruise_stop.set()
            self._cruise_stop = None
        if self._patrol_stop:
            self._patrol_stop.set()
            self._patrol_stop = None
        self.cruise_mode = None
        return self._goto_preset_raw(preset_token)

    def remove_preset(self, preset_token: str):
        self._require()
        with self._lock:
            t0 = time.perf_counter()
            self._ptz.RemovePreset({"ProfileToken": self._profile_token, "PresetToken": str(preset_token)})
            self.last_latency_ms = round((time.perf_counter() - t0) * 1000, 1)

    def goto_home(self) -> bool:
        self._require()
        with self._lock:
            try:
                self._ptz.GotoHomePosition({
                    "ProfileToken": self._profile_token,
                    "Speed": {"PanTilt": {"x": 0.5, "y": 0.5}},
                })
                return True
            except Exception:
                return False

    def cruise_horizontal(self, speed: float = 0.5):
        if self._patrol_stop:
            self._patrol_stop.set()
        if self._cruise_stop:
            self._cruise_stop.set()
        self._cruise_stop = threading.Event()
        self.cruise_mode = "h"
        direction = [1]

        def _loop():
            stop = self._cruise_stop
            while not stop.is_set():
                self.move_immediate(direction[0] * speed, 0)
                if stop.wait(8):
                    break
                self.stop_immediate()
                if stop.wait(0.5):
                    break
                direction[0] *= -1

        threading.Thread(target=_loop, daemon=True, name="onvif-cruise-h").start()

    def cruise_vertical(self, speed: float = 0.5):
        if self._patrol_stop:
            self._patrol_stop.set()
        if self._cruise_stop:
            self._cruise_stop.set()
        self._cruise_stop = threading.Event()
        self.cruise_mode = "v"
        direction = [1]

        def _loop():
            stop = self._cruise_stop
            while not stop.is_set():
                self.move_immediate(0, direction[0] * speed)
                if stop.wait(6):
                    break
                self.stop_immediate()
                if stop.wait(0.5):
                    break
                direction[0] *= -1

        threading.Thread(target=_loop, daemon=True, name="onvif-cruise-v").start()

    def stop_cruise(self):
        if self._cruise_stop:
            self._cruise_stop.set()
        if self.cruise_mode in ("h", "v"):
            self.cruise_mode = None
        self.stop()

    def start_patrol(self, preset_tokens: list[str], interval: int = 10):
        tokens = [str(t).strip() for t in (preset_tokens or []) if str(t).strip()]
        if not tokens:
            tokens = [p["token"] for p in self.get_presets() if p.get("token")]
        if not tokens:
            return
        if self._cruise_stop:
            self._cruise_stop.set()
            self._cruise_stop = None
        if self._patrol_stop:
            self._patrol_stop.set()
        sec = max(3, int(interval or 10))
        self.patrol_interval = sec
        self._patrol_stop = threading.Event()
        self.cruise_mode = "patrol"

        def _loop():
            stop = self._patrol_stop
            idx = 0
            while not stop.is_set():
                token = tokens[idx % len(tokens)]
                try:
                    self._goto_preset_raw(token)
                except Exception:
                    pass
                if stop.wait(sec):
                    break
                idx += 1

        threading.Thread(target=_loop, daemon=True, name="onvif-patrol-presets").start()

    def stop_patrol(self):
        if self._patrol_stop:
            self._patrol_stop.set()
        if self.cruise_mode in ("patrol", "sweep"):
            self.cruise_mode = None
        self.stop()

    def patrol_sweep(self, speed: float = 0.7, step_time: float = 0.8,
                     pause_time: float = 0.3, dwell_time: float = 3.0,
                     steps_per_direction: int = 6):
        self.stop_patrol()
        self.stop_cruise()
        self._patrol_stop = threading.Event()
        self.cruise_mode = "sweep"
        stop = self._patrol_stop
        logger.info("patrol_sweep START speed=%.2f step=%.1fs pause=%.1fs dwell=%.1fs steps/dir=%d",
                    speed, step_time, pause_time, dwell_time, steps_per_direction)

        def _loop():
            direction = 1
            cycle = 0
            while not stop.is_set():
                cycle += 1
                logger.info("patrol_sweep cycle=%d direction=%d", cycle, direction)
                for step in range(steps_per_direction):
                    if stop.is_set():
                        break
                    ok = self.move_immediate(direction * speed, 0)
                    if not ok:
                        logger.warning("patrol_sweep step=%d move_immediate failed, retrying next step", step+1)
                    if stop.wait(step_time):
                        break
                    self.stop_immediate()
                    if stop.wait(pause_time):
                        break
                if stop.is_set():
                    break
                self.stop_immediate()
                logger.info("patrol_sweep dwell %.1fs at extreme", dwell_time)
                if stop.wait(dwell_time):
                    break
                direction *= -1

        threading.Thread(target=_loop, daemon=True, name="onvif-patrol-sweep").start()

    def disconnect(self):
        self.stop_patrol()
        self.stop_cruise()
        self.cruise_mode = None
        self._move_stop.set()
        self._move_event.set()
        self._connected = False
        self._cam = None
        self._ptz = None
        self._media = None
        self._profile_token = None
        self._transport = None
