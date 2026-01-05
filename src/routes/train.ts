import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { rvcService } from '../services/rvc.js';
import { TrainRequest, TrainingJob } from '../types/index.js';

const router = Router();

// In-memory job store (use Redis/DB in production)
const trainingJobs = new Map<string, TrainingJob>();

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const jobId = (req as any).jobId || uuidv4();
    (req as any).jobId = jobId;
    const dir = `/tmp/voice-clone/training/${jobId}/dataset`;
    await fs.mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB total
  fileFilter: (req, file, cb) => {
    const allowed = ['.wav', '.mp3', '.flac', '.ogg', '.m4a'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${allowed.join(', ')}`));
    }
  },
});

/**
 * POST /train
 * Start training a new voice model
 *
 * Body (multipart/form-data):
 * - audio_files: Multiple audio files (10-30 min recommended)
 * - model_name: Name for the trained model
 * - epochs: Number of training epochs (default: 100)
 * - sample_rate: Target sample rate (default: 40000)
 * - f0_method: Pitch extraction method (default: rmvpe)
 */
router.post('/', upload.array('audio_files', 50), async (req, res) => {
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    return res.status(400).json({
      error: 'No audio files provided',
      hint: 'Upload 10-30 minutes of clean voice audio for best results',
    });
  }

  const {
    model_name,
    epochs = '100',
    sample_rate = '40000',
    f0_method = 'rmvpe',
  } = req.body as TrainRequest;

  if (!model_name) {
    return res.status(400).json({ error: 'model_name is required' });
  }

  // Validate model name
  if (!/^[a-zA-Z0-9_-]+$/.test(model_name)) {
    return res.status(400).json({
      error: 'Invalid model_name. Use only letters, numbers, underscores, hyphens',
    });
  }

  const jobId = (req as any).jobId;
  const datasetDir = `/tmp/voice-clone/training/${jobId}/dataset`;

  // Calculate total audio duration
  let totalDuration = 0;
  for (const file of files) {
    // Rough estimate: 1MB ≈ 1 minute for compressed audio
    totalDuration += file.size / (1024 * 1024);
  }

  const job: TrainingJob = {
    id: jobId,
    modelName: model_name,
    status: 'queued',
    progress: 0,
    epochs: parseInt(epochs),
    currentEpoch: 0,
    createdAt: new Date().toISOString(),
    estimatedDuration: `${Math.ceil(parseInt(epochs) * 0.5)} minutes`,
    audioFiles: files.length,
    totalAudioMinutes: Math.round(totalDuration),
  };

  trainingJobs.set(jobId, job);

  // Start training in background
  trainInBackground(jobId, {
    datasetDir,
    modelName: model_name,
    epochs: parseInt(epochs),
    sampleRate: parseInt(sample_rate),
    f0Method: f0_method,
  });

  res.status(202).json({
    job_id: jobId,
    status: 'queued',
    message: 'Training job started',
    status_url: `/train/status/${jobId}`,
    audio_files: files.length,
    total_audio_minutes: Math.round(totalDuration),
    epochs: parseInt(epochs),
    estimated_duration: job.estimatedDuration,
  });
});

/**
 * GET /train/status/:jobId
 * Get training job status
 */
router.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = trainingJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Training job not found' });
  }

  res.json({
    job_id: job.id,
    model_name: job.modelName,
    status: job.status,
    progress: job.progress,
    current_epoch: job.currentEpoch,
    total_epochs: job.epochs,
    created_at: job.createdAt,
    completed_at: job.completedAt,
    error: job.error,
    download_url: job.status === 'completed' ? `/train/download/${jobId}` : undefined,
  });
});

/**
 * GET /train/download/:jobId
 * Download trained model
 */
router.get('/download/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const job = trainingJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Training job not found' });
  }

  if (job.status !== 'completed') {
    return res.status(400).json({
      error: 'Training not completed',
      status: job.status,
    });
  }

  const modelPath = `/tmp/voice-clone/training/${jobId}/model/${job.modelName}.pth`;

  try {
    await fs.access(modelPath);
    res.download(modelPath, `${job.modelName}.pth`);
  } catch {
    res.status(404).json({ error: 'Model file not found' });
  }
});

/**
 * GET /train/jobs
 * List all training jobs
 */
router.get('/jobs', (req, res) => {
  const jobs = Array.from(trainingJobs.values()).map(job => ({
    job_id: job.id,
    model_name: job.modelName,
    status: job.status,
    progress: job.progress,
    created_at: job.createdAt,
  }));

  res.json({ jobs });
});

/**
 * DELETE /train/:jobId
 * Cancel/delete training job
 */
router.delete('/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const job = trainingJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Training job not found' });
  }

  // Cancel if running
  if (job.status === 'training') {
    await rvcService.cancelTraining(jobId);
  }

  // Clean up files
  try {
    await fs.rm(`/tmp/voice-clone/training/${jobId}`, { recursive: true });
  } catch {}

  trainingJobs.delete(jobId);

  res.json({ message: 'Training job deleted' });
});

// Background training function
async function trainInBackground(jobId: string, options: {
  datasetDir: string;
  modelName: string;
  epochs: number;
  sampleRate: number;
  f0Method: string;
}) {
  const job = trainingJobs.get(jobId);
  if (!job) return;

  try {
    job.status = 'preprocessing';
    job.progress = 5;

    // Preprocess audio
    await rvcService.preprocessDataset({
      datasetDir: options.datasetDir,
      modelName: options.modelName,
      sampleRate: options.sampleRate,
    });

    job.status = 'extracting_features';
    job.progress = 20;

    // Extract features
    await rvcService.extractFeatures({
      modelName: options.modelName,
      f0Method: options.f0Method,
    });

    job.status = 'training';
    job.progress = 30;

    // Train model with progress callback
    await rvcService.train({
      modelName: options.modelName,
      epochs: options.epochs,
      onProgress: (epoch: number, loss: number) => {
        job.currentEpoch = epoch;
        job.progress = 30 + Math.floor((epoch / options.epochs) * 65);
      },
    });

    job.status = 'indexing';
    job.progress = 95;

    // Create index
    await rvcService.createIndex({
      modelName: options.modelName,
    });

    // Move model to output
    const outputDir = `/tmp/voice-clone/training/${jobId}/model`;
    await fs.mkdir(outputDir, { recursive: true });

    job.status = 'completed';
    job.progress = 100;
    job.completedAt = new Date().toISOString();

  } catch (error: any) {
    job.status = 'failed';
    job.error = error.message;
  }
}

export { router as trainRouter };
