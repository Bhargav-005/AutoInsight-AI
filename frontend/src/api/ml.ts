import type { ProfileColumn } from './client'

export interface MLColumn extends Pick<ProfileColumn, 'id' | 'name' | 'data_type' | 'missing_percent' | 'distinct_count'> { identifier: boolean }
export type MLTask = 'classification' | 'regression'
export interface MLMetadata {
  row_count: number
  columns: MLColumn[]
  warnings: string[]
  algorithms: Record<MLTask, string[]>
}
export interface MLConfig {
  dataset_id: string
  dataset_version_id: string
  task_type: MLTask
  target_column: string
  feature_columns: string[]
  algorithm: string
  test_size: number
  random_seed: number
  regularization: number
  n_estimators: number
  max_depth: number
  independent_rows: boolean
}
export interface MLEvaluation {
  metrics: Record<string, number | null>
  baseline: Record<string, number | null>
  train_rows: number
  test_rows: number
  dropped_target_rows: number
  warnings: string[]
  inputs: MLColumn[]
  classes: string[]
  roc_auc_method: string | null
  class_distribution: { label: string; train: number; test: number }[]
  confusion_matrix: number[][]
  actual_predicted: { actual: number; predicted: number; residual: number }[]
  residual_summary: Record<string, number>
  explanation: { method: string; limitation: string; features: { name: string; value: number }[] }
  package_versions: Record<string, string>
}
export interface MLRun {
  id: string
  dataset_version_id: string
  task_type: MLTask
  target_column: string
  status: string
  config: MLConfig
  job_id: string | null
  error_message: string | null
  attempt_count: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  evaluation: MLEvaluation | null
  model_available: boolean
}
export interface MLPrediction {
  id: string
  created_at: string
  prediction: string | number
  probabilities: Record<string, number> | null
  note: string
}
