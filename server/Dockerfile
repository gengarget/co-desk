FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

ENV HOST=0.0.0.0
ENV CODESK_DATA_DIR=/app/data

EXPOSE 8124

CMD ["python", "main.py"]
