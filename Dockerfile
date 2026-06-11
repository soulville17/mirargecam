# InsightFace inswapper - Face Swap temps réel
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    python3.10 python3.10-dev python3-pip \
    libgl1 libglib2.0-0 libgomp1 \
    build-essential cmake git wget curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN python3.10 -m pip install --no-cache-dir --upgrade pip

RUN python3.10 -m pip install --no-cache-dir \
    torch==2.1.2 torchvision==0.16.2 \
    --index-url https://download.pytorch.org/whl/cu118

RUN python3.10 -m pip install --no-cache-dir \
    numpy==1.26.4 \
    opencv-python-headless \
    onnxruntime-gpu \
    insightface \
    huggingface_hub \
    runpod

WORKDIR /app
RUN mkdir -p /app/models

RUN python3.10 -c "\
from insightface.app import FaceAnalysis; \
app = FaceAnalysis(name='buffalo_l', root='/app/models', providers=['CPUExecutionProvider']); \
app.prepare(ctx_id=-1, det_size=(640,640)); \
print('buffalo_l OK')"

RUN python3.10 -c "\
from huggingface_hub import hf_hub_download; \
import os, shutil; \
path = hf_hub_download(repo_id='deepinsight/insightface', filename='models/inswapper_128.onnx', local_dir='/tmp/dl', local_dir_use_symlinks=False); \
shutil.copy(path, '/app/models/inswapper_128.onnx'); \
print('inswapper_128.onnx OK')"

COPY runpod_handler.py /app/handler.py

CMD ["python3.10", "-u", "/app/handler.py"]