print("=== PYTHON STARTED ===", flush=True)
import runpod
print("=== RUNPOD IMPORTED ===", flush=True)

def handler(event):
    print(f"[Handler] Job reçu", flush=True)
    try:
        import base64, cv2, numpy as np, io, os, time, urllib.request
        from PIL import Image
        import insightface
        from insightface.app import FaceAnalysis

        MODELS_DIR = "/app/models"
        INSWAPPER_PATH = os.path.join(MODELS_DIR, "inswapper_128.onnx")
        INSIGHTFACE_ROOT = "/app/insightface"

        # Télécharger inswapper si absent
        if not os.path.exists(INSWAPPER_PATH):
            os.makedirs(MODELS_DIR, exist_ok=True)
            print("[Handler] Téléchargement inswapper_128.onnx...", flush=True)
            for url in [
                "https://github.com/deepinsight/insightface/releases/download/v0.7/inswapper_128.onnx",
                "https://huggingface.co/deepinsight/inswapper/resolve/main/inswapper_128.onnx",
            ]:
                try:
                    urllib.request.urlretrieve(url, INSWAPPER_PATH)
                    print(f"[Handler] Modèle téléchargé!", flush=True)
                    break
                except Exception as e:
                    print(f"[Handler] Échec: {e}", flush=True)

        inp = event.get('input', {})
        source_b64 = inp.get('source_image')
        target_b64 = inp.get('target_image')

        if not source_b64 or not target_b64:
            return {"error": "source_image et target_image requis"}

        def b64_to_img(b64):
            if ',' in b64: b64 = b64.split(',')[1]
            data = base64.b64decode(b64)
            img = Image.open(io.BytesIO(data)).convert('RGB')
            return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

        start = time.time()
        src = b64_to_img(source_b64)
        tgt = b64_to_img(target_b64)
        print(f"[Handler] src shape: {src.shape}, tgt shape: {tgt.shape}", flush=True)

        # Seuil de détection bas (0.3) pour capturer plus de visages
        fa = FaceAnalysis(name='buffalo_l', root=INSIGHTFACE_ROOT,
                          providers=['CPUExecutionProvider'])
        fa.prepare(ctx_id=-1, det_size=(640, 640), det_thresh=0.3)

        src_faces = fa.get(src)
        tgt_faces = fa.get(tgt)
        print(f"[Handler] Visages src: {len(src_faces)}, tgt: {len(tgt_faces)}", flush=True)

        if not src_faces:
            # Debug: retourner l'image source pour voir ce que le handler reçoit
            _, buf = cv2.imencode('.jpg', src)
            debug_b64 = base64.b64encode(buf).decode('utf-8')
            return {"error": "Pas de visage dans source", "debug_source_image": debug_b64}
        if not tgt_faces: return {"error": "Pas de visage dans cible"}

        swapper = insightface.model_zoo.get_model(INSWAPPER_PATH,
                  providers=['CPUExecutionProvider'])
        result = swapper.get(tgt, tgt_faces[0], src_faces[0], paste_back=True)

        _, buf = cv2.imencode('.jpg', result, [cv2.IMWRITE_JPEG_QUALITY, 90])
        output_b64 = base64.b64encode(buf).decode('utf-8')
        elapsed = int((time.time() - start) * 1000)
        print(f"[Handler] Swap terminé en {elapsed}ms", flush=True)
        return {"output_image": output_b64, "processing_time": elapsed}

    except Exception as e:
        import traceback
        print(f"[Handler] ERREUR: {e}", flush=True)
        traceback.print_exc()
        return {"error": str(e)}

print("=== STARTING RUNPOD SERVER ===", flush=True)
runpod.serverless.start({"handler": handler})
