import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

const MODELS_DIR = process.env.MODELS_DIR || '/data/models';

/**
 * GET /models
 * List all available voice models
 */
router.get('/', async (req, res) => {
  try {
    await fs.mkdir(MODELS_DIR, { recursive: true });
    const files = await fs.readdir(MODELS_DIR);

    const models = await Promise.all(
      files
        .filter(f => f.endsWith('.pth'))
        .map(async f => {
          const stats = await fs.stat(path.join(MODELS_DIR, f));
          const indexFile = f.replace('.pth', '.index');
          const hasIndex = files.includes(indexFile);

          return {
            name: f.replace('.pth', ''),
            file: f,
            size_mb: Math.round(stats.size / (1024 * 1024)),
            has_index: hasIndex,
            created_at: stats.birthtime.toISOString(),
          };
        })
    );

    res.json({
      models,
      total: models.length,
      models_dir: MODELS_DIR,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to list models', details: error.message });
  }
});

/**
 * GET /models/:name
 * Get model details
 */
router.get('/:name', async (req, res) => {
  const { name } = req.params;
  const modelPath = path.join(MODELS_DIR, `${name}.pth`);

  try {
    const stats = await fs.stat(modelPath);
    const indexPath = path.join(MODELS_DIR, `${name}.index`);
    let hasIndex = false;

    try {
      await fs.access(indexPath);
      hasIndex = true;
    } catch {}

    res.json({
      name,
      file: `${name}.pth`,
      size_mb: Math.round(stats.size / (1024 * 1024)),
      has_index: hasIndex,
      created_at: stats.birthtime.toISOString(),
      modified_at: stats.mtime.toISOString(),
    });
  } catch {
    res.status(404).json({ error: 'Model not found' });
  }
});

/**
 * DELETE /models/:name
 * Delete a model
 */
router.delete('/:name', async (req, res) => {
  const { name } = req.params;
  const modelPath = path.join(MODELS_DIR, `${name}.pth`);
  const indexPath = path.join(MODELS_DIR, `${name}.index`);

  try {
    await fs.unlink(modelPath);
    try {
      await fs.unlink(indexPath);
    } catch {}

    res.json({ message: `Model ${name} deleted` });
  } catch {
    res.status(404).json({ error: 'Model not found' });
  }
});

export { router as modelsRouter };
