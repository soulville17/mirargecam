# RunPod Serverless Dockerfile for MirageCam Face Swap
FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

WORKDIR /app

# Dépendances système
RUN apt-get update && apt-get install -y \
    git \
    ffmpeg \
    libsm6 \
    libxext6 \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# Dépendances Python
RUN pip install --no-cache-dir \
    runpod \
    opencv-python-headless \
    numpy \
    pillow \
    insightface \
    onnxruntime-gpu \
    requests

# Créer les dossiers de modèles
RUN mkdir -p /app/models /app/insightface

# Copier le handler (modèles téléchargés au premier démarrage)
COPY runpod_handler.py /app/handler.py

ENV PYTHONUNBUFFERED=1
ENV NVIDIA_VISIBLE_DEVICES=all

CMD ["python", "-u", "/app/handler.py"]
