FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir runpod

WORKDIR /app
COPY runpod_handler.py /app/handler.py

CMD ["python", "-u", "/app/handler.py"]
