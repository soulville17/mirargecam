# MirageCam Face Swap Worker
FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    build-essential \
    cmake \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir numpy pillow requests
RUN pip install --no-cache-dir opencv-python-headless
RUN pip install --no-cache-dir onnxruntime
RUN pip install --no-cache-dir insightface
RUN pip install --no-cache-dir runpod

WORKDIR /app
RUN mkdir -p /app/models /app/insightface

COPY runpod_handler.py /app/handler.py

CMD ["python", "-u", "/app/handler.py"]
