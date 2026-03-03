#!/usr/bin/env python3
"""
Neon City — TTS Worker
Lightweight HTTP server wrapping Kokoro ONNX for text-to-speech.
Runs as a sidecar process, called by the Node.js server.

Usage: python3 tts-worker.py [--port 5175] [--models-dir /path/to/models]
"""

import argparse
import io
import json
import struct
import sys
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

# Lazy-load kokoro
_kokoro = None
_kokoro_lock = threading.Lock()


def get_kokoro(models_dir: str):
    global _kokoro
    if _kokoro is None:
        with _kokoro_lock:
            if _kokoro is None:
                from kokoro_onnx import Kokoro
                model_path = os.path.join(models_dir, "kokoro-v1.0.onnx")
                voices_path = os.path.join(models_dir, "voices-v1.0.bin")
                print(f"Loading Kokoro from {model_path}...", flush=True)
                _kokoro = Kokoro(model_path=model_path, voices_path=voices_path)
                print("Kokoro loaded!", flush=True)
    return _kokoro


def samples_to_wav(samples, sample_rate: int) -> bytes:
    """Convert numpy float32 samples to WAV bytes."""
    import numpy as np
    samples = np.clip(samples, -1.0, 1.0)
    pcm = (samples * 32767).astype(np.int16)
    buf = io.BytesIO()
    data_bytes = pcm.tobytes()
    # WAV header
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + len(data_bytes)))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
    buf.write(b"data")
    buf.write(struct.pack("<I", len(data_bytes)))
    buf.write(data_bytes)
    return buf.getvalue()


class TTSHandler(BaseHTTPRequestHandler):
    models_dir = ""

    def log_message(self, format, *args):
        # Quiet logging
        pass

    def do_GET(self):
        if self.path == "/health":
            self._json_response({"status": "ok", "engine": "kokoro-onnx"})
        elif self.path == "/voices":
            try:
                kokoro = get_kokoro(self.models_dir)
                voices = kokoro.get_voices()
                self._json_response({"voices": voices})
            except Exception as e:
                self._json_response({"error": str(e)}, 500)
        else:
            self._json_response({"error": "not found"}, 404)

    def do_POST(self):
        if self.path == "/tts":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length)) if length else {}

                text = body.get("text", "")
                voice = body.get("voice", "af_heart")
                speed = float(body.get("speed", 1.1))

                if not text:
                    self._json_response({"error": "text required"}, 400)
                    return

                kokoro = get_kokoro(self.models_dir)
                samples, sr = kokoro.create(text=text, voice=voice, speed=speed)
                wav_bytes = samples_to_wav(samples, sr)

                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(wav_bytes)))
                self.end_headers()
                self.wfile.write(wav_bytes)

            except Exception as e:
                self._json_response({"error": str(e)}, 500)
        else:
            self._json_response({"error": "not found"}, 404)

    def _json_response(self, data: dict, status: int = 200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Neon City TTS Worker")
    parser.add_argument("--port", type=int, default=5175)
    parser.add_argument("--models-dir", default=os.path.expanduser("~/voice_mode/models"))
    args = parser.parse_args()

    TTSHandler.models_dir = args.models_dir

    server = HTTPServer(("127.0.0.1", args.port), TTSHandler)
    print(f"TTS worker on http://localhost:{args.port}", flush=True)
    print(f"Models: {args.models_dir}", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nTTS worker stopped")
        server.server_close()


if __name__ == "__main__":
    main()
