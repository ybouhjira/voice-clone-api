export interface ConvertRequest {
  model_name: string;
  pitch_shift?: string;
  index_rate?: string;
  f0_method?: string;
}

export interface TrainRequest {
  model_name: string;
  epochs?: string;
  sample_rate?: string;
  f0_method?: string;
}

export interface TrainingJob {
  id: string;
  modelName: string;
  status: 'queued' | 'preprocessing' | 'extracting_features' | 'training' | 'indexing' | 'completed' | 'failed';
  progress: number;
  epochs: number;
  currentEpoch: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
  estimatedDuration?: string;
  audioFiles: number;
  totalAudioMinutes: number;
}

export interface Model {
  name: string;
  file: string;
  size_mb: number;
  has_index: boolean;
  created_at: string;
}
