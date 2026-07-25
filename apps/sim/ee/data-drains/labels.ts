import { CADENCE_TYPES, DESTINATION_TYPES, SOURCE_TYPES } from '@/lib/data-drains/types'

export const SOURCE_LABELS: Record<(typeof SOURCE_TYPES)[number], string> = {
  workflow_logs: 'Workflow logs',
  job_logs: 'Job logs',
  audit_logs: 'Audit logs',
  copilot_chats: 'Chats',
  copilot_runs: 'Chat runs',
}

export const DESTINATION_LABELS: Record<(typeof DESTINATION_TYPES)[number], string> = {
  s3: 'Amazon S3',
  gcs: 'Google Cloud Storage',
  azure_blob: 'Azure Blob Storage',
  datadog: 'Datadog',
  bigquery: 'Google BigQuery',
  snowflake: 'Snowflake',
  webhook: 'HTTPS webhook',
}

export const CADENCE_LABELS: Record<(typeof CADENCE_TYPES)[number], string> = {
  hourly: 'Every hour',
  daily: 'Every day',
}

export const SOURCE_OPTIONS = SOURCE_TYPES.map((t) => ({ value: t, label: SOURCE_LABELS[t] }))
export const CADENCE_OPTIONS = CADENCE_TYPES.map((t) => ({ value: t, label: CADENCE_LABELS[t] }))
export const DESTINATION_OPTIONS = DESTINATION_TYPES.map((t) => ({
  value: t,
  label: DESTINATION_LABELS[t],
}))
