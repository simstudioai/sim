import { auditLogsSource } from '@/ee/data-drains/lib/sources/audit-logs'
import { copilotChatsSource } from '@/ee/data-drains/lib/sources/copilot-chats'
import { copilotRunsSource } from '@/ee/data-drains/lib/sources/copilot-runs'
import { jobLogsSource } from '@/ee/data-drains/lib/sources/job-logs'
import { workflowLogsSource } from '@/ee/data-drains/lib/sources/workflow-logs'
import type { DrainSource, SourceType } from '@/ee/data-drains/lib/types'

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
