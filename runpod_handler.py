print("=== PYTHON STARTED ===", flush=True)
import runpod
print("=== RUNPOD IMPORTED ===", flush=True)

import os, sys, base64, io, time, tempfile, subprocess
import numpy as np

# ── Global pipeline cache ──────────────────────────────────────────────────
_pipeline = None
_lp_ready = False

LP_DIR = '/app/LivePortrait'
MODELS_DIR = '/app/pretrained_weights'

# ── Utils images ───────────────────────────────────────────────────────────
def b64_to_img(b64: str):
    import cv2
    if ',' in b64:
        b64 = b64.split(',')[1]
    data = base64.b64decode(b64)
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img

def img_to_b64(img) -> str:
    import cv2
    _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return base64.b64encode(buf).decode('utf-8')

# ── Setup LivePortrait ─────────────────────────────────────────────────────
def setup_liveportrait():
    global _pipeline, _lp_ready

    print("[Setup] Vérification LivePortrait...", flush=True)

    # Télécharger les modèles si absent
    lp_model_path = os.path.join(MODELS_DIR, 'liveportrait')
    if not os.path.exists(lp_model_path):
        print("[Setup] Téléchargement des modèles LivePortrait (~3GB)...", flush=True)
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id='KwaiVGI/LivePortrait',
            local_dir=MODELS_DIR,
            ignore_patterns=['*.git*', 'README*', '*.md', 'assets/*'],
        )
        print("[Setup] Modèles téléchargés!", flush=True)

    # Ajouter LivePortrait au path Python
    if LP_DIR not in sys.path:
        sys.path.insert(0, LP_DIR)

    # Importer pipeline
    from src.config.argument_config import ArgumentConfig
    from src.config.inference_config import InferenceConfig
    from src.config.crop_config import CropConfig
    from src.pipelines.liveportrait_pipeline import LivePortraitPipeline

    def partial_fields(target_class, kwargs):
        return target_class(**{k: v for k, v in kwargs.items() if hasattr(target_class, k)})

    args = ArgumentConfig()

    # Chemins des modèles
    args.checkpoint_F = f'{MODELS_DIR}/liveportrait/base_models/appearance_feature_extractor.pth'
    args.checkpoint_M = f'{MODELS_DIR}/liveportrait/base_models/motion_extractor.pth'
    args.checkpoint_W = f'{MODELS_DIR}/liveportrait/base_models/warping_module.pth'
    args.checkpoint_G = f'{MODELS_DIR}/liveportrait/base_models/spade_generator.pth'
    args.checkpoint_S = f'{MODELS_DIR}/liveportrait/retargeting_models/stitching_retargeting_module.pth'

    inference_cfg = partial_fields(InferenceConfig, args.__dict__)
    crop_cfg = partial_fields(CropConfig, args.__dict__)

    _pipeline = LivePortraitPipeline(inference_cfg=inference_cfg, crop_cfg=crop_cfg)
    _lp_ready = True
    print("[Setup] LivePortrait pipeline prêt!", flush=True)

# ── Animation LivePortrait ─────────────────────────────────────────────────
def animate_frame(source_img, driving_img):
    """
    source_img  = avatar portrait (BGR numpy)
    driving_img = webcam frame   (BGR numpy) — fournit pose + expression
    retourne    = avatar animé   (BGR numpy)
    """
    import cv2

    with tempfile.TemporaryDirectory() as tmpdir:
        source_path  = os.path.join(tmpdir, 'source.jpg')
        driving_path = os.path.join(tmpdir, 'driving.jpg')
        out_dir      = os.path.join(tmpdir, 'out')
        os.makedirs(out_dir)

        cv2.imwrite(source_path, source_img)
        cv2.imwrite(driving_path, driving_img)

        result = subprocess.run(
            [
                'python3.10', os.path.join(LP_DIR, 'inference.py'),
                '--source',      source_path,
                '--driving',     driving_path,
                '--output_dir',  out_dir,
                '--flag_do_crop',   'False',
                '--flag_pasteback', 'True',
                '--flag_use_half_precision', 'True',
            ],
            capture_output=True, text=True, cwd=LP_DIR
        )

        if result.returncode != 0:
            # Retourner source en fallback plutôt que planter
            print(f"[LivePortrait] Erreur: {result.stderr[-600:]}", flush=True)
            return source_img

        # Chercher l'image de sortie
        for root, _, files in os.walk(out_dir):
            for fname in sorted(files):
                fpath = os.path.join(root, fname)
                if fname.endswith(('.jpg', '.png')):
                    return cv2.imread(fpath)
                if fname.endswith('.mp4'):
                    cap = cv2.VideoCapture(fpath)
                    ret, frame = cap.read()
                    cap.release()
                    if ret:
                        return frame

    print("[LivePortrait] Pas de fichier output trouvé", flush=True)
    return source_img

# ── Handler principal ──────────────────────────────────────────────────────
def handler(event):
    print("[Handler] Job reçu", flush=True)
    try:
        start = time.time()
        inp = event.get('input', {})

        # source_image = avatar portrait  (ce qu'on veut animer)
        # target_image = webcam frame     (fournit les mouvements)
        source_b64  = inp.get('source_image')  # avatar
        driving_b64 = inp.get('target_image')  # webcam

        if not source_b64 or not driving_b64:
            return {"error": "source_image (avatar) et target_image (webcam) requis"}

        # Initialiser pipeline au premier appel
        if not _lp_ready:
            setup_liveportrait()

        source_img  = b64_to_img(source_b64)   # avatar
        driving_img = b64_to_img(driving_b64)  # webcam

        if source_img is None or driving_img is None:
            return {"error": "Impossible de décoder les images"}

        print(f"[Handler] Source: {source_img.shape}, Driving: {driving_img.shape}", flush=True)

        result_img = animate_frame(source_img, driving_img)

        output_b64 = img_to_b64(result_img)
        elapsed = int((time.time() - start) * 1000)

        print(f"[Handler] Animation terminée en {elapsed}ms", flush=True)
        return {
            "output_image":    output_b64,
            "processing_time": elapsed,
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}

print("=== STARTING RUNPOD SERVER ===", flush=True)
runpod.serverless.start({"handler": handler})
