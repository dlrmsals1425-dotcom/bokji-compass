"""Authenticated STT worker. Audio/transcripts stay in memory, never in logs/files."""
from contextlib import asynccontextmanager
import asyncio
from io import BytesIO
import os
from pathlib import Path
import secrets
from threading import Lock

import av
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel
import numpy as np
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 8 * 1024 * 1024
MAX_SAMPLES = 62 * 16000  # 60-second recording plus codec padding.
MODEL_PATH = Path(os.environ.get("STT_MODEL_DIR", str(ROOT / ".models/faster-whisper-small")))
TOKEN = os.environ.get("STT_SERVICE_TOKEN", "")
model = None
inference_lock = Lock()


@asynccontextmanager
async def lifespan(_app):
    global model
    if len(TOKEN) < 32:
        raise RuntimeError("Set STT_SERVICE_TOKEN to a random secret of at least 32 characters.")
    model = WhisperModel(str(MODEL_PATH), device="cpu", compute_type="int8",
                         cpu_threads=min(6, os.cpu_count() or 2), num_workers=1,
                         local_files_only=True)
    yield
    model = None


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def authorize(request):
    if not TOKEN or not secrets.compare_digest(request.headers.get("authorization", ""), f"Bearer {TOKEN}"):
        raise HTTPException(401, "unauthorized")


def decode_bounded(data):
    """Bound decoded samples too: small compressed files can contain long audio."""
    samples = []
    count = 0
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    with av.open(BytesIO(data)) as container:
        for frame in container.decode(audio=0):
            for output in resampler.resample(frame):
                values = output.to_ndarray().flatten()
                count += values.size
                if count > MAX_SAMPLES:
                    raise HTTPException(413, "audio_too_long")
                samples.append(values)
        for output in resampler.resample(None):
            values = output.to_ndarray().flatten()
            count += values.size
            if count > MAX_SAMPLES:
                raise HTTPException(413, "audio_too_long")
            samples.append(values)
    if not samples or count < 1600:
        raise HTTPException(422, "empty_audio")
    return np.concatenate(samples).astype(np.float32) / 32768.0


def recognize(data):
    try:
        audio = decode_bounded(data)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, "invalid_audio") from None
    # Avoid asking the model to transcribe silence.
    if np.max(np.abs(audio)) < 0.003:
        raise HTTPException(422, "no_speech")
    segments, _ = model.transcribe(audio, language="ko", beam_size=5,
                                  vad_filter=True, condition_on_previous_text=False)
    text = " ".join(segment.text.strip() for segment in segments).strip()
    if not text:
        raise HTTPException(422, "no_speech")
    return text


@app.get("/health")
async def health(request: Request):
    authorize(request)
    return JSONResponse({"ready": model is not None}, headers={"Cache-Control": "no-store"})


@app.post("/transcribe")
async def transcribe(request: Request):
    authorize(request)
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in {"audio/webm", "video/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/x-wav"}:
        raise HTTPException(415, "unsupported_audio")
    if model is None:
        raise HTTPException(503, "not_ready")
    if not inference_lock.acquire(blocking=False):
        raise HTTPException(429, "busy")
    try:
        data = bytearray()
        async with asyncio.timeout(15):
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_BYTES:
                    raise HTTPException(413, "audio_too_large")
                data.extend(chunk)
        if not data:
            raise HTTPException(422, "empty_audio")
        text = await run_in_threadpool(recognize, data)
        return JSONResponse({"text": text}, headers={"Cache-Control": "no-store"})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "transcription_failed") from None
    finally:
        inference_lock.release()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("STT_HOST", "127.0.0.1"),
                port=int(os.environ.get("STT_PORT", "8767")), access_log=False)
