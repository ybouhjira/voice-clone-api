FROM nvidia/cuda:11.8-cudnn8-runtime-ubuntu22.04

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    nodejs npm \
    ffmpeg \
    git wget curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Set working directory
WORKDIR /app

# Clone RVC
RUN git clone https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI.git /app/rvc

# Install RVC dependencies
WORKDIR /app/rvc
RUN pip3 install --no-cache-dir -r requirements.txt

# Download pretrained models
RUN mkdir -p assets/pretrained_v2 \
    && wget -q https://huggingface.co/lj1995/VoicConversionWebUI/resolve/main/pretrained_v2/f0G40k.pth -O assets/pretrained_v2/f0G40k.pth \
    && wget -q https://huggingface.co/lj1995/VoicConversionWebUI/resolve/main/pretrained_v2/f0D40k.pth -O assets/pretrained_v2/f0D40k.pth

# Copy API code
WORKDIR /app/api
COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY models/ ./models/ 2>/dev/null || true

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV RVC_DIR=/app/rvc
ENV MODELS_DIR=/data/models

# Create data directory
RUN mkdir -p /data/models

# Expose port
EXPOSE 3000

# Start the API
CMD ["node", "dist/index.js"]
