# Deploy Voice Clone API to RunPod

## Quick Deploy (RunPod GPU Pod)

1. Go to https://runpod.io/console/pods
2. Create new pod with:
   - GPU: RTX 3090 or A4000 (~$0.39/hr)
   - Template: RunPod PyTorch 2.1
   - Disk: 50GB

3. SSH into the pod and run:
```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/voice-clone-api.git
cd voice-clone-api

# Install RVC
git clone https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI.git rvc
cd rvc && pip install -r requirements.txt && cd ..

# Download pretrained models
mkdir -p rvc/assets/pretrained_v2
wget https://huggingface.co/lj1995/VoicConversionWebUI/resolve/main/pretrained_v2/f0G40k.pth -O rvc/assets/pretrained_v2/f0G40k.pth
wget https://huggingface.co/lj1995/VoicConversionWebUI/resolve/main/pretrained_v2/f0D40k.pth -O rvc/assets/pretrained_v2/f0D40k.pth

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install API dependencies
npm install
npm run build

# Start the API
export RVC_DIR=/workspace/voice-clone-api/rvc
export MODELS_DIR=/workspace/voice-clone-api/models
npm start
```

4. API will be available at: `https://YOUR_POD_ID-3000.proxy.runpod.net`

## API Endpoints

### Train Model
```bash
curl -X POST https://YOUR_POD-3000.proxy.runpod.net/train \
  -F "audio_files=@voice1.mp3" \
  -F "audio_files=@voice2.mp3" \
  -F "model_name=my_voice" \
  -F "epochs=100"
```

### Check Status
```bash
curl https://YOUR_POD-3000.proxy.runpod.net/train/status/JOB_ID
```

### Convert Voice
```bash
curl -X POST https://YOUR_POD-3000.proxy.runpod.net/convert \
  -F "audio=@input.mp3" \
  -F "model_name=my_voice"
```

### List Models
```bash
curl https://YOUR_POD-3000.proxy.runpod.net/models
```
