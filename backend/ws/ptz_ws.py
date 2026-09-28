import asyncio
from fastapi import WebSocket, WebSocketDisconnect
from backend.config import get_camera_by_id
from backend.services.onvif_service import OnvifService
from backend.auth import get_current_user_ws, get_token_from_ws

_connections: dict[str, OnvifService] = {}

ONVIF_CONNECT_TIMEOUT = 15.0


def _log(msg):
    print(f"[PTZ-WS] {msg}", flush=True)


def _get_onvif(camera_id: str) -> OnvifService:
    if camera_id not in _connections:
        _connections[camera_id] = OnvifService()
    return _connections[camera_id]


async def _run(fn, *args):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, fn, *args)


async def ptz_websocket(websocket: WebSocket, camera_id: str):
    token = get_token_from_ws(websocket)
    user = await get_current_user_ws(websocket) if token else None

    if user is None:
        await websocket.close(code=4001, reason="Token requerido")
        return

    if user["role"] == "traileradv":
        allowed = set(user.get("allowed_camera_ids", []))
        if camera_id not in allowed:
            await websocket.close(code=4003, reason="No tienes acceso a esta camara")
            return

    await websocket.accept()

    cam = get_camera_by_id(camera_id)
    if cam is None:
        await websocket.send_json({"error": "Camera not found"})
        await websocket.close()
        return

    onvif = _get_onvif(camera_id)

    if not onvif.is_connected:
        _log(f"Connecting ONVIF to {cam['ip']}...")
        try:
            result = await asyncio.wait_for(
                _run(onvif.connect, cam["ip"], cam["user"], cam["password"]),
                timeout=ONVIF_CONNECT_TIMEOUT,
            )
        except asyncio.TimeoutError:
            _log(f"ONVIF connect timeout after {ONVIF_CONNECT_TIMEOUT}s")
            result = {"success": False, "error": "ONVIF connection timeout"}
        except Exception as e:
            _log(f"ONVIF connect exception: {e}")
            result = {"success": False, "error": str(e)}

        if not result.get("success"):
            await websocket.send_json({"error": result.get("error", "Connection failed")})
            await websocket.close()
            return

    await websocket.send_json({
        "connected": True,
        "led": "on" if onvif._light_on else "off",
        "cruise_mode": onvif.cruise_mode,
        "patrol_interval": onvif.patrol_interval,
        "patrol_speed": onvif.patrol_speed,
    })

    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action", "")

            if not onvif.is_connected:
                res = await _run(onvif.connect, cam["ip"], cam["user"], cam["password"])
                if not res.get("success"):
                    await websocket.send_json({"ok": False, "error": res.get("error", "Not connected")})
                    continue

            match action:
                case "move":
                    pan = float(data.get("pan", 0))
                    tilt = float(data.get("tilt", 0))
                    ok = onvif.continuous_move(pan, tilt)
                    await websocket.send_json({"ok": ok, "cruise_mode": onvif.cruise_mode})

                case "stop":
                    ok = onvif.stop()
                    await websocket.send_json({"ok": ok})

                case "home":
                    ok = await _run(onvif.goto_home)
                    await websocket.send_json({"ok": ok})

                case "led_on":
                    ok = await _run(onvif.set_led, True)
                    await websocket.send_json({"ok": ok, "led": "on"})

                case "led_off":
                    ok = await _run(onvif.set_led, False)
                    await websocket.send_json({"ok": ok, "led": "off"})

                case "goto_preset":
                    ok = await _run(onvif.goto_preset, data.get("token", ""))
                    await websocket.send_json({"ok": ok, "cruise_mode": onvif.cruise_mode})

                case "set_preset":
                    try:
                        token = await _run(onvif.set_preset, data.get("name", ""))
                        presets = await _run(onvif.get_presets)
                        await websocket.send_json({"ok": True, "preset_token": token, "presets": presets})
                    except Exception:
                        await websocket.send_json({"ok": False})

                case "remove_preset":
                    await _run(onvif.remove_preset, data.get("token", ""))
                    presets = await _run(onvif.get_presets)
                    await websocket.send_json({"ok": True, "presets": presets})

                case "cruise_h":
                    onvif.cruise_horizontal(float(data.get("speed", 0.5)))
                    await websocket.send_json({"ok": True, "cruise_mode": onvif.cruise_mode})

                case "cruise_v":
                    onvif.cruise_vertical(float(data.get("speed", 0.5)))
                    await websocket.send_json({"ok": True, "cruise_mode": onvif.cruise_mode})

                case "stop_cruise":
                    onvif.stop_cruise()
                    await websocket.send_json({"ok": True, "cruise_mode": onvif.cruise_mode})

                case "patrol":
                    tokens = data.get("tokens", [])
                    interval = int(data.get("interval", 10))
                    speed = float(data.get("speed", 0.25))
                    await _run(onvif.start_patrol, tokens, interval, speed)
                    await websocket.send_json({
                        "ok": True,
                        "cruise_mode": onvif.cruise_mode,
                        "patrol_interval": onvif.patrol_interval,
                        "patrol_speed": onvif.patrol_speed,
                    })

                case "stop_patrol":
                    onvif.stop_patrol()
                    await websocket.send_json({"ok": True, "cruise_mode": onvif.cruise_mode})

                case "patrol_sweep":
                    speed = float(data.get("speed", 0.5))
                    onvif.patrol_sweep(speed=speed)
                    await websocket.send_json({"ok": True, "cruise_mode": onvif.cruise_mode})

                case "stop_sweep":
                    onvif.stop_patrol()
                    onvif.stop_cruise()
                    await websocket.send_json({"ok": True, "cruise_mode": onvif.cruise_mode})

                case "presets":
                    presets = await _run(onvif.get_presets)
                    await websocket.send_json({"presets": presets})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        _log(f"Exception: {type(e).__name__}: {e}")
