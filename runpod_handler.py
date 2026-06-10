"""
RunPod Serverless Handler for MirageCam Face Swap
InsightFace inswapper_128 — GPU (CUDA) ou CPU fallback
"""

import runpod
import base64
import cv2
import numpy as np
from PIL import Image
import io
import os
import time

# Chemins des modèles (correspondant au Dockerfile)
MODELS_DIR = "/app/models"
INSIGHTFACE_ROOT = "/app/insightface"
INSWAPPER_PATH = os.path.join(MODELS_DIR, "inswapper_128.onnx")

# Modèles globaux (chargés une fois au démarrage)
face_swapper = None
face_analyser = None


def download_model_if_needed():
    """Télécharger inswapper_128.onnx si absent"""
    if os.path.exists(INSWAPPER_PATH):
        return
    print("[MirageCam] Téléchargement du modèle inswapper_128.onnx...")
    os.makedirs(MODELS_DIR, exist_ok=True)
    import urllib.request
    # Essayer plusieurs sources
    urls = [
        "https://github.com/deepinsight/insightface/releases/download/v0.7/inswapper_128.onnx",
        "https://huggingface.co/deepinsight/inswapper/resolve/main/inswapper_128.onnx",
    ]
    for url in urls:
        try:
            urllib.request.urlretrieve(url, INSWAPPER_PATH)
            print(f"[MirageCam] Modèle téléchargé depuis {url}")
            return
        except Exception as e:
            print(f"[MirageCam] Échec {url}: {e}")
    raise RuntimeError("Impossible de télécharger inswapper_128.onnx")


def load_models():
    """Charger les modèles une seule fois (cold start)"""
    global face_swapper, face_analyser

    if face_swapper is not None:
        return face_swapper, face_analyser

    print("[MirageCam] Chargement des modèles...")
    download_model_if_needed()

    import insightface
    from insightface.app import FaceAnalysis

    # Analyse de visages
    face_analyser = FaceAnalysis(
        name='buffalo_l',
        root=INSIGHTFACE_ROOT,
        providers=['CUDAExecutionProvider', 'CPUExecutionProvider']
    )
    face_analyser.prepare(ctx_id=0, det_size=(640, 640))

    # Modèle de swap
    face_swapper = insightface.model_zoo.get_model(
        INSWAPPER_PATH,
        providers=['CUDAExecutionProvider', 'CPUExecutionProvider']
    )

    print("[MirageCam] Modèles chargés avec succès")
    return face_swapper, face_analyser


def base64_to_image(b64_string):
    """Base64 → numpy array BGR"""
    if ',' in b64_string:
        b64_string = b64_string.split(',')[1]
    data = base64.b64decode(b64_string)
    img = Image.open(io.BytesIO(data)).convert('RGB')
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def image_to_base64(image):
    """numpy array BGR → base64 JPEG"""
    _, buf = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return base64.b64encode(buf).decode('utf-8')


def handler(event):
    """
    Handler RunPod Serverless

    Input:
        source_image: base64 — visage de l'avatar
        target_image: base64 — frame caméra de l'utilisateur

    Output:
        output_image: base64 — frame avec le visage swappé
        processing_time: ms
    """
    start = time.time()

    try:
        inp = event.get('input', {})
        source_b64 = inp.get('source_image')
        target_b64 = inp.get('target_image')

        if not source_b64 or not target_b64:
            return {"error": "source_image et target_image sont requis"}

        swapper, analyser = load_models()

        source_img = base64_to_image(source_b64)
        target_img = base64_to_image(target_b64)

        # Détecter les visages
        source_faces = analyser.get(source_img)
        target_faces = analyser.get(target_img)

        if len(source_faces) == 0:
            return {"error": "Aucun visage détecté dans l'image source (avatar)"}
        if len(target_faces) == 0:
            return {"error": "Aucun visage détecté dans l'image cible (caméra)"}

        # Swap
        result = swapper.get(target_img, target_faces[0], source_faces[0], paste_back=True)

        output_b64 = image_to_base64(result)
        processing_time = int((time.time() - start) * 1000)

        print(f"[MirageCam] Swap OK en {processing_time}ms")

        return {
            "output_image": output_b64,
            "processing_time": processing_time,
            "status": "success"
        }

    except Exception as e:
        print(f"[MirageCam] Erreur: {e}")
        return {"error": str(e)}


# Démarrer le handler RunPod
runpod.serverless.start({"handler": handler})
