# MirageCam Face Swap Worker — RunPod Serverless
FROM python:3.10

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Dépendances système
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Dépendances Python
RUN pip install --no-cache-dir numpy pillow requests opencv-python-headless onnxruntime insightface runpod

# Dossier de travail
WORKDIR /app
RUN mkdir -p /app/models /app/insightface

# Copier le handler
COPY runpod_handler.py /app/handler.py

CMD ["python", "-u", "/app/handler.py"]
