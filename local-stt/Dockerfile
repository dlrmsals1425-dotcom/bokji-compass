FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
RUN python -c "from faster_whisper.utils import download_model; download_model('small', output_dir='/models/small')"
COPY server.py ./
ENV STT_MODEL_DIR=/models/small STT_HOST=0.0.0.0 STT_PORT=8767 HF_HUB_OFFLINE=1
EXPOSE 8767
USER 65532:65532
CMD ["python", "server.py"]
