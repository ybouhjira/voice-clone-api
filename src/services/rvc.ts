import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

const RVC_DIR = process.env.RVC_DIR || '/app/rvc';
const MODELS_DIR = process.env.MODELS_DIR || '/data/models';

interface ConvertOptions {
  inputPath: string;
  outputPath: string;
  modelName: string;
  pitchShift: number;
  indexRate: number;
  f0Method: string;
}

interface PreprocessOptions {
  datasetDir: string;
  modelName: string;
  sampleRate: number;
}

interface ExtractFeaturesOptions {
  modelName: string;
  f0Method: string;
}

interface TrainOptions {
  modelName: string;
  epochs: number;
  onProgress?: (epoch: number, loss: number) => void;
}

interface IndexOptions {
  modelName: string;
}

// Track running processes for cancellation
const runningProcesses = new Map<string, ChildProcess>();

class RVCService {
  /**
   * Convert audio using trained model
   */
  async convert(options: ConvertOptions): Promise<{ processingTime: number }> {
    const startTime = Date.now();

    const modelPath = path.join(MODELS_DIR, `${options.modelName}.pth`);
    const indexPath = path.join(MODELS_DIR, `${options.modelName}.index`);

    // Check model exists
    try {
      await fs.access(modelPath);
    } catch {
      throw new Error(`Model not found: ${options.modelName}`);
    }

    // Check for index file (optional)
    let indexArg = '';
    try {
      await fs.access(indexPath);
      indexArg = indexPath;
    } catch {}

    return new Promise((resolve, reject) => {
      const args = [
        path.join(RVC_DIR, 'tools/infer_cli.py'),
        '--input_path', options.inputPath,
        '--output_path', options.outputPath,
        '--model_path', modelPath,
        '--pitch_shift', options.pitchShift.toString(),
        '--index_rate', options.indexRate.toString(),
        '--f0_method', options.f0Method,
      ];

      if (indexArg) {
        args.push('--index_path', indexArg);
      }

      const proc = spawn('python3', args, {
        cwd: RVC_DIR,
        env: { ...process.env, CUDA_VISIBLE_DEVICES: '0' },
      });

      let stderr = '';
      proc.stderr.on('data', data => {
        stderr += data.toString();
      });

      proc.on('close', code => {
        if (code === 0) {
          resolve({ processingTime: Date.now() - startTime });
        } else {
          reject(new Error(`Conversion failed: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Preprocess audio dataset for training
   */
  async preprocessDataset(options: PreprocessOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        path.join(RVC_DIR, 'infer/modules/train/preprocess.py'),
        options.datasetDir,
        options.sampleRate.toString(),
        '2', // CPU threads
        path.join(RVC_DIR, 'logs', options.modelName),
        'False', // No normalization
      ];

      const proc = spawn('python3', args, {
        cwd: RVC_DIR,
        env: { ...process.env },
      });

      let stderr = '';
      proc.stderr.on('data', data => {
        stderr += data.toString();
        console.log('[preprocess]', data.toString());
      });

      proc.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Preprocessing failed: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Extract pitch and features from preprocessed audio
   */
  async extractFeatures(options: ExtractFeaturesOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        path.join(RVC_DIR, 'infer/modules/train/extract/extract_f0_print.py'),
        path.join(RVC_DIR, 'logs', options.modelName),
        '2', // CPU threads
        options.f0Method,
      ];

      const proc = spawn('python3', args, {
        cwd: RVC_DIR,
        env: { ...process.env },
      });

      let stderr = '';
      proc.stderr.on('data', data => {
        stderr += data.toString();
        console.log('[extract_f0]', data.toString());
      });

      proc.on('close', code => {
        if (code === 0) {
          // Also run feature extraction
          this.extractHubertFeatures(options.modelName)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error(`F0 extraction failed: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  private async extractHubertFeatures(modelName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        path.join(RVC_DIR, 'infer/modules/train/extract_feature_print.py'),
        'cuda:0',
        '1', // GPU number
        '0', // Part
        '1', // Total parts
        path.join(RVC_DIR, 'logs', modelName),
        'v2', // RVC version
      ];

      const proc = spawn('python3', args, {
        cwd: RVC_DIR,
        env: { ...process.env, CUDA_VISIBLE_DEVICES: '0' },
      });

      let stderr = '';
      proc.stderr.on('data', data => {
        stderr += data.toString();
        console.log('[extract_feature]', data.toString());
      });

      proc.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Feature extraction failed: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Train the voice model
   */
  async train(options: TrainOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        path.join(RVC_DIR, 'infer/modules/train/train.py'),
        '-e', options.modelName,
        '-sr', '40k',
        '-f0', '1',
        '-bs', '8', // Batch size
        '-te', options.epochs.toString(),
        '-se', '25', // Save every N epochs
        '-pg', path.join(RVC_DIR, 'assets/pretrained_v2/f0G40k.pth'),
        '-pd', path.join(RVC_DIR, 'assets/pretrained_v2/f0D40k.pth'),
        '-l', '0',
        '-c', '0',
        '-sw', '0',
        '-v', 'v2',
      ];

      const proc = spawn('python3', args, {
        cwd: RVC_DIR,
        env: { ...process.env, CUDA_VISIBLE_DEVICES: '0' },
      });

      runningProcesses.set(options.modelName, proc);

      proc.stdout.on('data', data => {
        const output = data.toString();
        console.log('[train]', output);

        // Parse epoch progress
        const epochMatch = output.match(/Epoch: (\d+)/);
        const lossMatch = output.match(/loss: ([\d.]+)/);

        if (epochMatch && options.onProgress) {
          const epoch = parseInt(epochMatch[1]);
          const loss = lossMatch ? parseFloat(lossMatch[1]) : 0;
          options.onProgress(epoch, loss);
        }
      });

      let stderr = '';
      proc.stderr.on('data', data => {
        stderr += data.toString();
        console.log('[train:err]', data.toString());
      });

      proc.on('close', code => {
        runningProcesses.delete(options.modelName);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Training failed: ${stderr}`));
        }
      });

      proc.on('error', err => {
        runningProcesses.delete(options.modelName);
        reject(err);
      });
    });
  }

  /**
   * Create FAISS index for the model
   */
  async createIndex(options: IndexOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        path.join(RVC_DIR, 'tools/infer/train-index.py'),
        path.join(RVC_DIR, 'logs', options.modelName),
        'v2',
      ];

      const proc = spawn('python3', args, {
        cwd: RVC_DIR,
        env: { ...process.env },
      });

      let stderr = '';
      proc.stderr.on('data', data => {
        stderr += data.toString();
        console.log('[index]', data.toString());
      });

      proc.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Index creation failed: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Cancel a running training job
   */
  async cancelTraining(jobId: string): Promise<void> {
    const proc = runningProcesses.get(jobId);
    if (proc) {
      proc.kill('SIGTERM');
      runningProcesses.delete(jobId);
    }
  }
}

export const rvcService = new RVCService();
