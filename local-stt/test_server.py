"""Boundary tests without loading a model or sending audio to external services."""
import asyncio
from io import BytesIO
import unittest
from unittest.mock import patch
import wave

from fastapi import HTTPException
from starlette.requests import Request
import server


def wav(seconds=1):
    output = BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\0\0" * int(16000 * seconds))
    return output.getvalue()


def request(data=b"audio", token="test-secret", content_type="audio/wav"):
    async def receive():
        return {"type": "http.request", "body": data, "more_body": False}
    return Request({"type": "http", "method": "POST", "path": "/transcribe",
                    "headers": [(b"authorization", f"Bearer {token}".encode()),
                                (b"content-type", content_type.encode())]}, receive)


class WorkerTests(unittest.TestCase):
    def assert_http(self, status, action):
        with self.assertRaises(HTTPException) as error:
            action()
        self.assertEqual(error.exception.status_code, status)

    def test_decodes_wav_to_mono_16k(self):
        self.assertEqual(server.decode_bounded(wav()).shape, (16000,))

    def test_rejects_decoded_duration_over_limit(self):
        self.assert_http(413, lambda: server.decode_bounded(wav(63)))

    def test_rejects_short_audio(self):
        self.assert_http(422, lambda: server.decode_bounded(wav(0.01)))

    def test_silence_is_rejected_without_inference(self):
        self.assert_http(422, lambda: server.recognize(wav()))

    def test_invalid_audio_is_sanitized(self):
        self.assert_http(422, lambda: server.recognize(b"not an audio file"))

    def test_auth_required(self):
        with patch.object(server, "TOKEN", "test-secret"):
            self.assert_http(401, lambda: server.authorize(request(token="wrong")))
            server.authorize(request())

    def test_body_type_and_size_bounds(self):
        with patch.object(server, "TOKEN", "test-secret"), patch.object(server, "model", object()):
            self.assert_http(415, lambda: asyncio.run(server.transcribe(request(content_type="text/plain"))))
            self.assert_http(413, lambda: asyncio.run(server.transcribe(request(b"x" * (server.MAX_BYTES + 1)))))
            self.assert_http(422, lambda: asyncio.run(server.transcribe(request(b""))))
            self.assertFalse(server.inference_lock.locked())

    def test_busy_worker_does_not_queue_more_inference(self):
        with patch.object(server, "TOKEN", "test-secret"), patch.object(server, "model", object()):
            server.inference_lock.acquire()
            try:
                self.assert_http(429, lambda: asyncio.run(server.transcribe(request())))
            finally:
                server.inference_lock.release()


if __name__ == "__main__":
    unittest.main()
