export type PreviewRunStatus = 'Completed' | 'Error'

export interface PreviewRunSpan {
  name: string
  duration: string
  durationMs: number
  type:
    | 'start_trigger'
    | 'agent'
    | 'response'
    | 'webhook'
    | 'table'
    | 'schedule'
    | 'api'
    | 'slack'
    | 'file'
  input: string
  output: string
  error?: boolean
}

export interface PreviewRun {
  id: string
  name: string
  status: PreviewRunStatus
  duration: string
  credits: string
  trigger: string
  time: string
  spans: readonly PreviewRunSpan[]
}
