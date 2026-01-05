import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pino } from 'pino';
import { convertRouter } from './routes/convert.js';
import { trainRouter } from './routes/train.js';
import { modelsRouter } from './routes/models.js';
import { errorHandler } from './middleware/errorHandler.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '1.0.0',
    endpoints: {
      convert: 'POST /convert - Convert voice using trained model',
      train: 'POST /train - Train new voice model',
      models: 'GET /models - List available models',
    },
  });
});

// Routes
app.use('/convert', convertRouter);
app.use('/train', trainRouter);
app.use('/models', modelsRouter);

// Error handler
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Voice Clone API running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

export { app };
