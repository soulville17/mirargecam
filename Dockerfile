# Base officielle RunPod — garantit la compatibilité
FROM runpod/base:0.4.0-py3.11

ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

# Dépendances système pour OpenCV
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Dépendances Python
RUN python3.11 -m pip install --no-cache-dir \
    opencv-python-headless \
    numpy \
    pillow \
    requests \
    onnxruntime \
    insightface

WORKDIR /app
RUN mkdir -p /app/models /app/insightface

COPY runpod_handler.py /app/handler.py

CMD ["python3.11", "-u", "/app/handler.py"]
