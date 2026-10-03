import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'

interface WorkflowStateResponse {
  data: Record<string, unknown>
}

/**
 * One workflow's draft state — the v2 source of truth the analysis engines read.
 *
 * The `/state` route, not `/export`: export is sanitized for sharing, which nulls
 * workspace-specific fields such as a Table block's `tableId` while leaving its
 * advanced-mode marker, so a lint over the export reported a working block as missing
 * "Table ID" although the same graph linted clean inside `operations apply`.
 */
export async function fetchWorkflowState(
  runtime: AgentCliRuntime,
  workflowId: string
): Promise<Record<string, unknown>> {
  const response = await runtime.client.request<WorkflowStateResponse>(
    `/api/v2/workflows/${encodeURIComponent(workflowId)}/state`
  )
  return response.data
}
