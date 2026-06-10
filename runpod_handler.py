print("PYTHON STARTED", flush=True)

import runpod

print("RUNPOD IMPORTED", flush=True)

def handler(event):
    print(f"[Handler] Requête reçue", flush=True)
    try:
        import base64, cv2, numpy as np, io, os, time, urllib.request
        from PIL import Image
        import insightface
        from insightface.app import FaceAnalysis

        print("[Handler] Imports OK", flush=True)

        MODELS_DIR = "/app/models"
        INSWAPPER_PATH = os.path.join(MODELS_DIR, "inswapper_128.onnx")
        INSIGHTFACE_ROOT = "/app/insightface"

        # Télécharger le modèle si absent
        if not os.path.exists(INSWAPPER_PATH):
            os.makedirs(MODELS_DIR, exist_ok=True)
            print("[Handler] Téléchargement inswapper_128.onnx...", flush=True)
            for url in [
                "https://github.com/deepinsight/insightface/releases/download/v0.7/inswapper_128.onnx",
                "https://huggingface.co/deepinsight/inswapper/resolve/main/inswapper_128.onnx",
            ]:
                try:
                    urllib.request.urlretrieve(url, INSWAPPER_PATH)
                    print(f"[Handler] Modèle téléchargé depuis {url}", flush=True)
                    break
                except Exception as e:
                    print(f"[Handler] Échec {url}: {e}", flush=True)

        inp = event.get('input', {})
        source_b64 = inp.get('source_image')
        target_b64 = inp.get('target_image')

        if not source_b64 or not target_b64:
            return {"error": "source_image et target_image sont requis"}

        def b64_to_img(b64):
            if ',' in b64: b64 = b64.split(',')[1]
            data = base64.b64decode(b64)
            img = Image.open(io.BytesIO(data)).convert('RGB')
            return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

        start = time.time()

        fa = FaceAnalysis(name='buffalo_l', root=INSIGHTFACE_ROOT,
                          providers=['CPUExecutionProvider'])
        fa.prepare(ctx_id=-1, det_size=(640, 640))
        swapper = insightface.model_zoo.get_model(INSWAPPER_PATH,
                  providers=['CPUExecutionProvider'])

        src = b64_to_img(source_b64)
        tgt = b64_to_img(target_b64)

        src_faces = fa.get(src)
        tgt_faces = fa.get(tgt)
        if not src_faces: return {"error": "Pas de visage dans source"}
        if not tgt_faces: return {"error": "Pas de visage dans cible"}

        result = swapper.get(tgt, tgt_faces[0], src_faces[0], paste_back=True)
        _, buf = cv2.imencode('.jpg', result, [cv2.IMWRITE_JPEG_QUALITY, 90])
        output_b64 = base64.b64encode(buf).decode('utf-8')
        elapsed = int((time.time() - start) * 1000)
        print(f"[Handler] Terminé en {elapsed}ms", flush=True)
        return {"output_image": output_b64, "processing_time": elapsed}

    except Exception as e:
        import traceback
        print(f"[Handler] ERREUR: {e}", flush=True)
        traceback.print_exc()
        return {"error": str(e)}

print("STARTING RUNPOD SERVER", flush=True)
runpod.serverless.start({"handler": handler})
