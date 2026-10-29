# the vision worker: yolo pose + deepsort, blurs everyone, sends table counts to the resto api.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    YOLO_CONFIG_DIR=/tmp/ultralytics
WORKDIR /app

# opencv needs these system libraries to read videos
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

# pytorch first. cpu by default (much smaller); for an nvidia gpu, build with docker/docker-compose.gpu.yml,
# which picks the cuda build of pytorch (the gpu itself is given to the container at run time)
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
ARG TORCH_VERSION=2.15.0
ARG TORCHVISION_VERSION=0.29.2
RUN pip install --no-cache-dir torch==${TORCH_VERSION} torchvision==${TORCHVISION_VERSION} --index-url ${TORCH_INDEX}
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y opencv-python && pip install --no-cache-dir opencv-python-headless==5.0.0.93

# the model is downloaded at build time and checked against its known fingerprint:
# the running worker never fetches anything from the internet, and the weights cannot be swapped silently
ARG MODEL_URL=https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26n-pose.pt
ARG MODEL_SHA256=eb3bb8268828aeaf515cec23a4bfafd793944a86fe9af94ba7823609c14522a9
RUN curl -fsSL -o yolo26n-pose.pt "$MODEL_URL" && echo "$MODEL_SHA256  yolo26n-pose.pt" | sha256sum -c -

COPY resto_vision ./resto_vision
# the demo clip (mixkit free license, see docs/VISION.md): downloaded and checked like the model,
# so no raw footage of people is stored in the repository
ARG SAMPLE_URL=https://assets.mixkit.co/videos/4385/4385-720.mp4
ARG SAMPLE_SHA256=0949077e575842910401fda801dea0aaa47f259064ccd0d32d89f53652a45af3
RUN mkdir -p samples && curl -fsSL -o samples/restaurant.mp4 "$SAMPLE_URL"     && echo "$SAMPLE_SHA256  samples/restaurant.mp4" | sha256sum -c -

# never run as root
RUN useradd --create-home vision && chown -R vision /app
USER vision

EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fs http://localhost:8090/healthz || exit 1
CMD ["python", "-m", "resto_vision", "run"]
