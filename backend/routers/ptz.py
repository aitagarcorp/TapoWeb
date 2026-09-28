from fastapi import APIRouter, HTTPException, Request
from backend.config import get_camera_by_id
from backend.models import PTZCommand
from backend.auth import get_current_user_http
from backend.ws.ptz_ws import _connections, _get_onvif

router = APIRouter(prefix="/api/ptz", tags=["ptz"])


def _check_camera_access(camera_id: str, user: dict):
    cam = get_camera_by_id(camera_id)
    if cam is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    if user["role"] == "traileradv":
        allowed = set(user.get("allowed_camera_ids", []))
        if camera_id not in allowed:
            raise HTTPException(status_code=403, detail="No tienes acceso a esta camara")
    return cam


@router.post("/{camera_id}/connect")
def connect_ptz(camera_id: str, request: Request):
    user = get_current_user_http(request)
    cam = _check_camera_access(camera_id, user)
    onvif = _get_onvif(camera_id)
    result = onvif.connect(cam["ip"], cam["user"], cam["password"])
    result["cruise_mode"] = onvif.cruise_mode
    result["led"] = "on" if onvif._light_on else "off"
    return result


@router.post("/{camera_id}/disconnect")
def disconnect_ptz(camera_id: str, request: Request):
    get_current_user_http(request)
    onvif = _connections.pop(camera_id, None)
    if onvif:
        onvif.disconnect()
    return {"success": True}


@router.get("/{camera_id}/status")
def ptz_status(camera_id: str, request: Request):
    user = get_current_user_http(request)
    _check_camera_access(camera_id, user)
    onvif = _get_onvif(camera_id)
    return {
        "connected": onvif.is_connected,
        "led": "on" if onvif._light_on else "off",
        "cruise_mode": onvif.cruise_mode,
        "patrol_interval": onvif.patrol_interval,
        "last_latency_ms": onvif.last_latency_ms,
    }


@router.post("/{camera_id}/command")
def ptz_command(camera_id: str, cmd: PTZCommand, request: Request):
    user = get_current_user_http(request)
    cam = _check_camera_access(camera_id, user)
    onvif = _get_onvif(camera_id)
    if not onvif.is_connected:
        res = onvif.connect(cam["ip"], cam["user"], cam["password"])
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "PTZ not connected"))

    match cmd.action:
        case "move":
            onvif.continuous_move(cmd.pan, cmd.tilt)
        case "stop":
            onvif.stop()
        case "goto_preset":
            onvif.goto_preset(cmd.preset_token)
        case "set_preset":
            token = onvif.set_preset(cmd.preset_name)
            return {"success": True, "token": token, "presets": onvif.get_presets()}
        case "remove_preset":
            onvif.remove_preset(cmd.preset_token)
            return {"success": True, "presets": onvif.get_presets()}
        case "home":
            onvif.goto_home()
        case "led_on":
            onvif.set_led(True)
        case "led_off":
            onvif.set_led(False)
        case "cruise_h":
            onvif.cruise_horizontal(cmd.speed)
        case "cruise_v":
            onvif.cruise_vertical(cmd.speed)
        case "stop_cruise":
            onvif.stop_cruise()
        case "patrol":
            tokens = cmd.preset_token.split(",") if cmd.preset_token else []
            onvif.start_patrol(tokens, cmd.interval)
        case "stop_patrol":
            onvif.stop_patrol()
        case "patrol_sweep":
            onvif.patrol_sweep(speed=cmd.speed)
        case "stop_sweep":
            onvif.stop_patrol()
            onvif.stop_cruise()
        case _:
            raise HTTPException(status_code=400, detail=f"Unknown action: {cmd.action}")

    return {
        "success": True,
        "cruise_mode": onvif.cruise_mode,
        "patrol_interval": onvif.patrol_interval,
        "led": "on" if onvif._light_on else "off",
        "last_latency_ms": onvif.last_latency_ms,
    }


@router.get("/{camera_id}/presets")
def get_presets(camera_id: str, request: Request):
    user = get_current_user_http(request)
    cam = _check_camera_access(camera_id, user)
    onvif = _get_onvif(camera_id)
    if not onvif.is_connected:
        res = onvif.connect(cam["ip"], cam["user"], cam["password"])
        if not res.get("success"):
            raise HTTPException(status_code=400, detail="PTZ not connected")
    return onvif.get_presets()
