import { auditLogsSource } from '@/lib/data-drains/sources/audit-logs'
import { copilotChatsSource } from '@/lib/data-drains/sources/copilot-chats'
import { copilotRunsSource } from '@/lib/data-drains/sources/copilot-runs'
import { jobLogsSource } from '@/lib/data-drains/sources/job-logs'
import { workflowLogsSource } from '@/lib/data-drains/sources/workflow-logs'
import type { DrainSource, SourceType } from '@/lib/data-drains/types'

export const SOURCE_REGISTRY = {
  workflow_logs: workflowLogsSource,
  job_logs: jobLogsSource,
  audit_logs: auditLogsSource,
  copilot_chats: copilotChatsSource,
  copilot_runs: copilotRunsSource,
} as const satisfies Record<SourceType, DrainSource>

export function getSource(type: SourceType): DrainSource {
  return SOURCE_REGISTRY[type]
}
