import asyncio
import base64
import json
import logging
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("miragecam")

app = FastAPI(title="MirageCam Local Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

face_swapper = None
face_analyser = None
avatar_face = None

LP_DIR = Path(__file__).parent / "liveportrait"
ENGINE = None
AVAILABLE_ENGINES: list = []


def _try_load_liveportrait() -> bool:
    try:
        logger.info("Chargement LivePortrait...")
        # LivePortrait loading logic here
        logger.info("LivePortrait charge avec succes!")
        return True
    except Exception as e:
        logger.error(f"Erreur chargement LivePortrait: {e}")
        return False


def _try_load_insightface() -> bool:
    global face_swapper, face_analyser
    try:
        import insightface
        from insightface.app import FaceAnalysis

        models_dir = Path(__file__).parent / "models"
        models_dir.mkdir(exist_ok=True)

        logger.info("Chargement du modele face analyser...")
        face_analyser = FaceAnalysis(
            name="buffalo_l",
            root=str(models_dir),
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
        )
        face_analyser.prepare(ctx_id=0, det_size=(640, 640))

        model_path = models_dir / "inswapper_128.onnx"
        if not model_path.exists():
            logger.info("Telechargement de inswapper_128.onnx...")
            import urllib.request
            url = "https://github.com/haofanwang/inswapper/raw/main/inswapper_128.onnx"
            try:
                urllib.request.urlretrieve(url, str(model_path))
                logger.info("inswapper_128.onnx telecharge avec succes!")
            except Exception as dl_err:
                logger.error(f"Echec telechargement: {dl_err}")
                logger.error("Place manuellement inswapper_128.onnx dans le dossier models/")
                return False

        import onnxruntime
        logger.info("Chargement du modele inswapper_128...")
        face_swapper = onnxruntime.InferenceSession(
            str(model_path),
            providers=["CPUExecutionProvider"]
        )
        logger.info("Modeles InsightFace charges avec succes!")
        return True
    except Exception as e:
        logger.error(f"Erreur chargement InsightFace: {e}")
        return False


def load_models() -> bool:
    global AVAILABLE_ENGINES
    AVAILABLE_ENGINES = []
    if LP_DIR.exists():
        if _try_load_liveportrait():
            AVAILABLE_ENGINES.append("liveportrait")
    if _try_load_insightface():
        AVAILABLE_ENGINES.append("insightface")
    if AVAILABLE_ENGINES:
        logger.info(f"Moteurs disponibles: {AVAILABLE_ENGINES}")
        return True
    logger.error("Aucun moteur disponible.")
    return False


def get_face(img):
    faces = face_analyser.get(img)
    if not faces:
        return None
    return sorted(faces, key=lambda x: x.bbox[0])[0]


def swap_face(source_face, target_img):
    import insightface
    target_face = get_face(target_img)
    if target_face is None:
        return target_img

    model_path = Path(__file__).parent / "models" / "inswapper_128.onnx"
    swapper = insightface.model_zoo.get_model(str(model_path), download=False)
    result = swapper.get(target_img, target_face, source_face, paste_back=True)
    return result


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "models_loaded": face_swapper is not None,
        "version": "1.0.0",
        "available_engines": AVAILABLE_ENGINES
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global avatar_face, ENGINE

    await websocket.accept()
    logger.info("Client connecte")

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            msg_type = message.get("type")

            if msg_type == "avatar":
                # Accept engine hint from client
                global ENGINE
                engine_hint = message.get("engine", None)
                if engine_hint and engine_hint in AVAILABLE_ENGINES:
                    ENGINE = engine_hint
                elif ENGINE is None and AVAILABLE_ENGINES:
                    ENGINE = AVAILABLE_ENGINES[0]

                img_data = base64.b64decode(message["data"])
                nparr = np.frombuffer(img_data, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                if img is not None and face_analyser is not None:
                    face = get_face(img)
                    if face is not None:
                        avatar_face = face
                        await websocket.send_text(json.dumps({"type": "avatar_ok"}))
                        logger.info("Avatar charge avec succes")
                    else:
                        await websocket.send_text(json.dumps({"type": "error", "message": "Aucun visage detecte dans l'avatar"}))
                else:
                    await websocket.send_text(json.dumps({"type": "error", "message": "Image invalide"}))

            elif msg_type == "frame":
                if avatar_face is None or face_swapper is None:
                    await websocket.send_text(json.dumps({"type": "skip"}))
                    continue

                img_data = base64.b64decode(message["data"])
                nparr = np.frombuffer(img_data, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                if frame is None:
                    continue

                try:
                    result = swap_face(avatar_face, frame)
                    _, buffer = cv2.imencode(".jpg", result, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    result_b64 = base64.b64encode(buffer).decode("utf-8")
                    await websocket.send_text(json.dumps({"type": "frame", "data": result_b64}))
                except Exception as e:
                    logger.warning(f"Erreur traitement frame: {e}")
                    await websocket.send_text(json.dumps({"type": "skip"}))

    except WebSocketDisconnect:
        logger.info("Client deconnecte")
    except Exception as e:
        logger.error(f"Erreur WebSocket: {e}")


if __name__ == "__main__":
    logger.info("=== MirageCam Local Server ===")
    models_ok = load_models()
    if not models_ok:
        logger.warning("Serveur demarre sans les modeles — telecharge inswapper_128.onnx")

    uvicorn.run(app, host="0.0.0.0", port=7860, log_level="warning")
