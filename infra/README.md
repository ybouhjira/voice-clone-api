# Voice Clone API - GCloud Deployment

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
| `gpuCount` | 1 | Number of GPUs |

## Cost Estimate

- T4 GPU + n1-standard-4: ~$0.35/hr
- 100GB SSD: ~$17/month

## After Deploy

API available at the output URL:
```bash
curl http://YOUR_IP:3000/health
```

## Destroy

```bash
pulumi destroy
```
