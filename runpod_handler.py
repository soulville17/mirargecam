import sys
print("=== PYTHON STARTED ===", flush=True)
sys.stdout.flush()

import runpod
print("=== RUNPOD IMPORTED ===", flush=True)

def handler(job):
    print(f"=== JOB RECEIVED: {job} ===", flush=True)
    return {"status": "ok", "message": "Worker fonctionne!"}

print("=== STARTING SERVER ===", flush=True)
runpod.serverless.start({"handler": handler})
