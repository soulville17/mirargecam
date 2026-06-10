# Image CUDA pour GPU acceleration
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    build-essential \
    cmake \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN python3.10 -m pip install --no-cache-dir numpy pillow requests
RUN python3.10 -m pip install --no-cache-dir opencv-python-headless
RUN python3.10 -m pip install --no-cache-dir onnxruntime-gpu
RUN python3.10 -m pip install --no-cache-dir insightface
RUN python3.10 -m pip install --no-cache-dir runpod

WORKDIR /app
RUN mkdir -p /app/models /app/insightface

COPY runpod_handler.py /app/handler.py

CMD ["python3.10", "-u", "/app/handler.py"]
