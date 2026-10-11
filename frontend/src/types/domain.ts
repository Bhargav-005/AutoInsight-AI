/** Anticipated /api/v1 contracts; only health is connected in Phase 2. */
export interface ApiEnvelope<T> {
  data: T | null
  meta: { request_id: string; version: 'v1' }
  error: { code: string; message: string } | null
}
export type ResourceState<T> =
  | {
      kind:
        | 'loading'
        | 'empty'
        | 'network'
        | 'unauthorized'
        | 'forbidden'
        | 'unsupported'
    }
  | { kind: 'success'; data: T }
  | { kind: 'validation' | 'failed'; message: string }
  | { kind: 'running'; progress: number | null }
export interface Dataset {
  id: string
  name: string
  version: string
  rows: number
  columns: number
  bytes: number
  source: 'development-fixture'
}
export interface Job {
  id: string
  state: 'queued' | 'running' | 'completed' | 'failed'
  progress: number | null
  error: string | null
}
export interface Evidence {
  id: string
  dataset_version_id: string
  method: string
  artifact_reference: string | null
}
export interface Experiment {
  id: string
  dataset_version_id: string
  task: 'classification' | 'regression'
  metrics: Record<string, number> | null
  job: Job
}
export interface Report {
  id: string
  dataset_id: string
  title: string
  created_at: string
  artifact_reference: string | null
}
export type DataRow = Record<string, string | number | null>
export interface WorkspaceFixture {
  dataset: Dataset
  rows: DataRow[]
  monthly: { month: string; revenue: number; orders: number }[]
  categories: { category: string; revenue: number }[]
  history: {
    id: string
    title: string
    type: string
    status: string
    date: string
  }[]
}
