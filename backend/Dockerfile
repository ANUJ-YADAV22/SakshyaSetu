FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 SAKSHYA_DATA_DIR=/tmp/sakshya-data
WORKDIR /app
# Tesseract gives OCR for scanned pages; libglib is needed by OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt opencv-python-headless pytesseract
COPY . .
RUN useradd -m app && chown -R app /app
USER app
# Render sets $PORT; Hugging Face Spaces uses 7860
EXPOSE 7860
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-7860}"]
