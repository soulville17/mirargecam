"""
MirageCam Face Swap Handler — RunPod Serverless
"""
import runpod
import base64
import cv2
import numpy as np
from PIL import Image
import io
import os
import time
import urllib.request

MODELS_DIR = "/app/models"
INSWAPPER_PATH = os.path.join(MODELS_DIR, "inswapper_128.onnx")
INSIGHTFACE_ROOT = "/app/insightface"

def download_model():
    """Télécharger inswapper_128.onnx si absent."""
    if os.path.exists(INSWAPPER_PATH):
        return True
    os.makedirs(MODELS_DIR, exist_ok=True)
    print("[Model] Téléchargement de inswapper_128.onnx...", flush=True)
    urls = [
        "https://github.com/deepinsight/insightface/releases/download/v0.7/inswapper_128.onnx",
        "https://huggingface.co/deepinsight/inswapper/resolve/main/inswapper_128.onnx",
    ]
    for url in urls:
        try:
            print(f"[Model] Essai: {url}", flush=True)
            urllib.request.urlretrieve(url, INSWAPPER_PATH)
            print("[Model] Téléchargement réussi!", flush=True)
            return True
        except Exception as e:
            print(f"[Model] Échec: {e}", flush=True)
    return False

def b64_to_img(b64_str):
    """Décoder une image base64 en numpy array BGR."""
    if ',' in b64_str:
        b64_str = b64_str.split(',')[1]
    data = base64.b64decode(b64_str)
    img = Image.open(io.BytesIO(data)).convert('RGB')
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

# Charger les modèles une seule fois au démarrage
print("[Init] Chargement InsightFace...", flush=True)
import insightface
from insightface.app import FaceAnalysis

download_model()

face_analyzer = FaceAnalysis(
    name='buffalo_l',
    root=INSIGHTFACE_ROOT,
    providers=['CPUExecutionProvider']
)
face_analyzer.prepare(ctx_id=-1, det_size=(640, 640))

swapper = insightface.model_zoo.get_model(
    INSWAPPER_PATH,
    providers=['CPUExecutionProvider']
)
print("[Init] Modèles chargés, prêt!", flush=True)

def handler(event):
    start = time.time()
    print(f"[Handler] Nouvelle requête: {event}", flush=True)

    inp = event.get('input', {})
    source_b64 = inp.get('source_image')
    target_b64 = inp.get('target_image')

    if not source_b64 or not target_b64:
        return {"error": "source_image et target_image sont requis"}

    try:
        src = b64_to_img(source_b64)
        tgt = b64_to_img(target_b64)

        src_faces = face_analyzer.get(src)
        tgt_faces = face_analyzer.get(tgt)

        if not src_faces:
            return {"error": "Aucun visage détecté dans source_image"}
        if not tgt_faces:
            return {"error": "Aucun visage détecté dans target_image"}

        result = swapper.get(tgt, tgt_faces[0], src_faces[0], paste_back=True)

        _, buf = cv2.imencode('.jpg', result, [cv2.IMWRITE_JPEG_QUALITY, 90])
        output_b64 = base64.b64encode(buf).decode('utf-8')

        elapsed = int((time.time() - start) * 1000)
        print(f"[Handler] Swap terminé en {elapsed}ms", flush=True)

        return {
            "output_image": output_b64,
            "processing_time": elapsed
        }

    except Exception as e:
        print(f"[Handler] Erreur: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return {"error": str(e)}

runpod.serverless.start({"handler": handler})
