"""Run with .venv-stt Python after installing local-stt/requirements.txt."""
from pathlib import Path
import secrets
from faster_whisper.utils import download_model

root = Path(__file__).resolve().parents[1]
download_model("small", output_dir=str(root / ".models/faster-whisper-small"))
env_file = root / ".env.local"
existing = env_file.read_text(encoding="utf-8") if env_file.exists() else ""
lines = existing.splitlines()
defaults = {"STT_SERVICE_URL": "http://127.0.0.1:8767", "STT_SERVICE_TOKEN": secrets.token_hex(32)}
for name, default in defaults.items():
    matching = [index for index, line in enumerate(lines) if line.split("=", 1)[0].strip() == name]
    if not matching:
        lines.append(name + "=" + default)
    elif not lines[matching[-1]].split("=", 1)[1].strip().strip("\"'"):
        lines[matching[-1]] = name + "=" + default
env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("STT model and server-only configuration are ready. No secret values printed.")
