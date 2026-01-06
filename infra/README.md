# VoiceSwap API - GCloud Deployment

Deploy with one command using Pulumi.

## Prerequisites

```bash
npm install -g pulumi
gcloud auth login
gcloud auth application-default login
```

## Deploy

```bash
cd infra
npm install
pulumi stack init dev  # Create your own stack
pulumi config set gcp:project YOUR_PROJECT_ID
pulumi config set project YOUR_PROJECT_ID
pulumi up
```

## Configuration Options

| Config | Default | Description |
|--------|---------|-------------|
| `project` | required | GCP Project ID |
| `region` | us-central1 | GCP Region |
| `zone` | us-central1-a | GCP Zone |
| `machineType` | n1-standard-4 | VM Machine Type |
| `gpuType` | nvidia-tesla-t4 | GPU Type |
| `gpuCount` | 0 | Number of GPUs (0 = CPU only) |

## Cost Estimate

**With GPU:**
- T4 GPU + n1-standard-4: ~$0.35/hr

**CPU Only:**
- e2-medium: ~$0.03/hr (good for testing)

## After Deploy

API available at the output URL:
```bash
curl http://YOUR_IP:3000/health
```

## API Endpoints

- `POST /train` - Train a new voice model
- `GET /train/status/:id` - Check training status
- `POST /convert` - Convert audio using a trained model
- `GET /models` - List available models

## Destroy

```bash
pulumi destroy
```
