from fastapi import APIRouter, HTTPException, Request

from backend.auth import (
    verify_password,
    create_access_token,
    get_current_user_http,
    get_trailer_user,
    update_trailer_cameras,
    list_users_public,
    create_user,
    update_user,
    delete_user,
    TOKEN_EXPIRE_HOURS,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _require_admin(request: Request) -> dict:
    current = get_current_user_http(request)
    if current.get("role") != "baseadv":
        raise HTTPException(status_code=403, detail="Solo el administrador puede realizar esta accion")
    return current


@router.post("/login")
def login(body: dict):
    username = (body.get("username") or "").strip()
    password = (body.get("password") or "")
    if not username or not password:
        raise HTTPException(status_code=400, detail="Usuario y contrasena requeridos")
    user = verify_password(username, password)
    if user is None:
        raise HTTPException(status_code=401, detail="Credenciales invalidas")
    token = create_access_token({"sub": user["username"], "role": user["role"]})
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": TOKEN_EXPIRE_HOURS * 3600,
        "user": user,
    }


@router.get("/me")
def me(request: Request):
    user = get_current_user_http(request)
    return user


@router.get("/trailer-cameras")
def get_trailer_cameras(request: Request):
    current = _require_admin(request)
    trailer = get_trailer_user(current["role"])
    if trailer is None:
        return {"allowed_camera_ids": []}
    return {"allowed_camera_ids": trailer.get("allowed_camera_ids", [])}


@router.put("/trailer-cameras")
def set_trailer_cameras(body: dict, request: Request):
    _require_admin(request)
    camera_ids = body.get("allowed_camera_ids", [])
    if not isinstance(camera_ids, list):
        raise HTTPException(status_code=400, detail="allowed_camera_ids debe ser una lista")
    update_trailer_cameras(camera_ids)
    return {"success": True, "allowed_camera_ids": camera_ids}


@router.get("/users")
def get_users(request: Request):
    _require_admin(request)
    return list_users_public()


@router.post("/users")
def add_user(body: dict, request: Request):
    _require_admin(request)
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    role = body.get("role") or "traileradv"
    allowed_camera_ids = body.get("allowed_camera_ids")
    try:
        user = create_user(username=username, password=password, role=role, allowed_camera_ids=allowed_camera_ids)
        return {"user": user, "users": list_users_public()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/users/{username}")
def edit_user(username: str, body: dict, request: Request):
    _require_admin(request)
    new_username = body.get("username")
    password = body.get("password")
    role = body.get("role")
    allowed_camera_ids = body.get("allowed_camera_ids")
    try:
        user = update_user(
            username=username,
            new_username=new_username,
            password=password,
            role=role,
            allowed_camera_ids=allowed_camera_ids,
        )
        return {"user": user, "users": list_users_public()}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/users/{username}")
def remove_user(username: str, request: Request):
    current = _require_admin(request)
    try:
        delete_user(username, current_username=current.get("username"))
        return {"users": list_users_public()}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

