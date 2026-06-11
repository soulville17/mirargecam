# LivePortrait - Animation avatar temps réel
FROM nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04

ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

# System packages
RUN apt-get update && apt-get install -y \
    python3.10 python3.10-dev python3-pip \
    libgl1 libglib2.0-0 libgomp1 \
    build-essential cmake git ffmpeg wget curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# PyTorch 2.1 avec CUDA 11.8
RUN python3.10 -m pip install --no-cache-dir \
    torch==2.1.2 torchvision==0.16.2 \
    --index-url https://download.pytorch.org/whl/cu118

# Dépendances core
RUN python3.10 -m pip install --no-cache-dir \
    numpy==1.26.4 \
    pillow \
    requests \
    opencv-python-headless \
    scipy \
    imageio \
    imageio-ffmpeg \
    tqdm \
    pyyaml \
    einops \
    huggingface_hub \
    omegaconf \
    safetensors \
    tyro \
    lmdb \
    cython

# onnxruntime-gpu + insightface (pour détection de visage dans LivePortrait)
RUN python3.10 -m pip install --no-cache-dir onnxruntime-gpu insightface

# runpod serverless
RUN python3.10 -m pip install --no-cache-dir runpod

# Clone LivePortrait
RUN git clone --depth=1 https://github.com/KwaiVGI/LivePortrait /app/LivePortrait

# Installer requirements LivePortrait
RUN cd /app/LivePortrait && \
    python3.10 -m pip install --no-cache-dir -r requirements.txt 2>/dev/null || true

WORKDIR /app
RUN mkdir -p /app/pretrained_weights /app/insightface

# ── Télécharger les modèles LivePortrait dans l'image (pas de download au démarrage) ──
RUN python3.10 -c "\
from huggingface_hub import snapshot_download; \
snapshot_download(\
  repo_id='KwaiVGI/LivePortrait', \
  local_dir='/app/pretrained_weights', \
  ignore_patterns=['*.git*','README*','*.md','assets/*'] \
)"

COPY runpod_handler.py /app/handler.py

CMD ["python3.10", "-u", "/app/handler.py"]
