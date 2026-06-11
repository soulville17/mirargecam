print("=== PYTHON STARTED ===", flush=True)
import runpod
print("=== RUNPOD IMPORTED ===", flush=True)

import os, base64, time
import numpy as np
import cv2
import insightface
from insightface.app import FaceAnalysis

_face_analyser = None
_face_swapper  = None

MODELS_DIR     = '/app/models'
INSWAPPER_PATH = os.path.join(MODELS_DIR, 'inswapper_128.onnx')

def b64_to_img(b64: str):
    if ',' in b64:
        b64 = b64.split(',')[1]
    data = base64.b64decode(b64)
    arr  = np.frombuffer(data, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)

def img_to_b64(img) -> str:
    _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return base64.b64encode(buf).decode('utf-8')

def setup_models():
    global _face_analyser, _face_swapper
    print("[Setup] Initialisation InsightFace...", flush=True)
    os.makedirs(MODELS_DIR, exist_ok=True)
    if not os.path.exists(INSWAPPER_PATH):
        print("[Setup] Téléchargement inswapper_128.onnx...", flush=True)
        from huggingface_hub import hf_hub_download
        hf_hub_download(
            repo_id='deepinsight/insightface',
            filename='models/inswapper_128.onnx',
            local_dir=MODELS_DIR,
            local_dir_use_symlinks=False,
        )
        nested = os.path.join(MODELS_DIR, 'models', 'inswapper_128.onnx')
        if os.path.exists(nested):
            os.rename(nested, INSWAPPER_PATH)
        print("[Setup] inswapper_128.onnx prêt!", flush=True)
    _face_analyser = FaceAnalysis(
        name='buffalo_l',
        root=MODELS_DIR,
        providers=['CUDAExecutionProvider', 'CPUExecutionProvider']
    )
    _face_analyser.prepare(ctx_id=0, det_size=(640, 640))
    _face_swapper = insightface.model_zoo.get_model(
        INSWAPPER_PATH,
        providers=['CUDAExecutionProvider', 'CPUExecutionProvider']
    )
    print("[Setup] Modèles InsightFace prêts!", flush=True)

def swap_face(source_img, target_img):
    source_faces = _face_analyser.get(source_img)
    target_faces = _face_analyser.get(target_img)
    if not source_faces:
        print("[Swap] Aucun visage dans source — retour target brut", flush=True)
        return target_img
    if not target_faces:
        print("[Swap] Aucun visage dans target — retour target brut", flush=True)
        return target_img
    source_face = source_faces[0]
    result = target_img.copy()
    for target_face in target_faces:
        result = _face_swapper.get(result, target_face, source_face, paste_back=True)
    return result

def handler(event):
    print("[Handler] Job reçu", flush=True)
    try:
        start = time.time()
        inp = event.get('input', {})
        source_b64 = inp.get('source_image')
        target_b64 = inp.get('target_image')
        if not source_b64 or not target_b64:
            return {"error": "source_image et target_image requis"}
        if _face_analyser is None or _face_swapper is None:
            setup_models()
        source_img = b64_to_img(source_b64)
        target_img = b64_to_img(target_b64)
        if source_img is None or target_img is None:
            return {"error": "Impossible de décoder les images"}
        print(f"[Handler] Source: {source_img.shape}, Target: {target_img.shape}", flush=True)
        result_img = swap_face(source_img, target_img)
        output_b64 = img_to_b64(result_img)
        elapsed    = int((time.time() - start) * 1000)
        print(f"[Handler] Face swap terminé en {elapsed}ms", flush=True)
        return {"output_image": output_b64, "processing_time": elapsed}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}

print("=== STARTING RUNPOD SERVER ===", flush=True)
runpod.serverless.start({"handler": handler})