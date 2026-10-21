"""Real-model smoke test using a synthetic/public WAV, never a user's microphone."""
import argparse
from io import BytesIO
import json
from pathlib import Path
import time
import urllib.error
import urllib.request
import wave

parser = argparse.ArgumentParser()
parser.add_argument("wav", type=Path, help="Synthetic Korean WAV test fixture")
parser.add_argument("--url", default="http://127.0.0.1:3220")
parser.add_argument("--direct-worker", action="store_true")
parser.add_argument("--skip-silence", action="store_true", help="Skip the separate silence request (e.g. billable API smoke test)")
args = parser.parse_args()
url = args.url.rstrip("/")
headers = {"Content-Type": "audio/wav", "Origin": url}
endpoint = "/api/voice/transcribe"
if args.direct_worker:
    env = dict(line.split("=", 1) for line in (Path(__file__).resolve().parents[1] / ".env.local").read_text().splitlines()
               if "=" in line and not line.startswith("#"))
    headers["Authorization"] = "Bearer " + env["STT_SERVICE_TOKEN"]
    endpoint = "/transcribe"
start = time.monotonic()
request = urllib.request.Request(url + endpoint, data=args.wav.read_bytes(), headers=headers)
with urllib.request.urlopen(request, timeout=120) as response:
    result = json.load(response)
text = result["text"]
assert "수원" in text, text
assert "일자리" in text, text
assert "월세" in text, text
print(json.dumps({"synthetic_korean_text": text, "elapsed_seconds": round(time.monotonic() - start, 2)}, ensure_ascii=False))

if args.skip_silence:
    raise SystemExit(0)

silence = BytesIO()
with wave.open(silence, "wb") as audio:
    audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(16000)
    audio.writeframes(b"\0\0" * 32000)
try:
    urllib.request.urlopen(urllib.request.Request(url + endpoint, data=silence.getvalue(), headers=headers), timeout=120)
    raise AssertionError("Silent audio was accepted")
except urllib.error.HTTPError as error:
    assert error.code == 422, error.code
    print("Silent audio: HTTP 422 (no transcript)")
