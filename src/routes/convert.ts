import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { rvcService } from '../services/rvc.js';
import { ConvertRequest } from '../types/index.js';

const router = Router();

const storage = multer.diskStorage({
  destination: '/tmp/voice-clone/input',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
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

// Ensure directories exist
async function ensureDirs() {
  await fs.mkdir('/tmp/voice-clone/input', { recursive: true });
  await fs.mkdir('/tmp/voice-clone/output', { recursive: true });
}
ensureDirs();

/**
 * POST /convert
 * Convert audio to target voice
 */
router.post('/', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  const {
    model_name,
    pitch_shift = '0',
    index_rate = '0.75',
    f0_method = 'rmvpe',
  } = req.body as ConvertRequest;

  if (!model_name) {
    return res.status(400).json({ error: 'model_name is required' });
  }

  const jobId = uuidv4();
  const outputPath = `/tmp/voice-clone/output/${jobId}.wav`;

  try {
    const result = await rvcService.convert({
      inputPath: req.file.path,
      outputPath,
      modelName: model_name,
      pitchShift: parseInt(pitch_shift),
      indexRate: parseFloat(index_rate),
      f0Method: f0_method,
    });

    res.json({
      job_id: jobId,
      status: 'completed',
      output_url: `/convert/download/${jobId}`,
      processing_time: result.processingTime,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Conversion failed',
      details: error.message,
    });
  }
});

/**
 * GET /convert/download/:jobId
 * Download converted audio
 */
router.get('/download/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const outputPath = `/tmp/voice-clone/output/${jobId}.wav`;

  try {
    await fs.access(outputPath);
    res.download(outputPath, `converted_${jobId}.wav`);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

export { router as convertRouter };
