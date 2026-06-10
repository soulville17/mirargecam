# MirageCam Face Swap Worker — RunPod Serverless
FROM python:3.10-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Dépendances système
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    build-essential \
    cmake \
    git \
    && rm -rf /var/lib/apt/lists/*

# Dépendances Python (CPU — stable et compatible partout)
RUN pip install --no-cache-dir numpy pillow requests opencv-python-headless
RUN pip install --no-cache-dir onnxruntime
RUN pip install --no-cache-dir insightface
RUN pip install --no-cache-dir runpod

# Dossier de travail
WORKDIR /app
RUN mkdir -p /app/models /app/insightface

# Copier le handler
COPY runpod_handler.py /app/handler.py

CMD ["python", "-u", "/app/handler.py"]
