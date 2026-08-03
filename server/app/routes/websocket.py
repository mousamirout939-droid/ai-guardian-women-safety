import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import decode_token
from app.core.ws_manager import manager

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/alerts")
async def alerts_socket(websocket: WebSocket, token: str):
    try:
        payload = decode_token(token)
        user_id = payload["sub"]
    except (jwt.PyJWTError, KeyError):
        await websocket.close(code=4401)
        return

    await manager.connect(user_id, websocket)
    try:
        while True:
            # Client doesn't need to send anything; this keeps the socket alive
            # and lets us detect disconnects.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(user_id, websocket)
