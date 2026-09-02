import type { ExportWorkflowResponse } from 'sim/embed'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'

/** One workflow's exported state — the v2 source of truth the analysis engines read. */
export async function fetchWorkflowState(
  runtime: AgentCliRuntime,
  workflowId: string
): Promise<Record<string, unknown>> {
  const response = await runtime.client.request<ExportWorkflowResponse>(
    `/api/v2/workflows/${encodeURIComponent(workflowId)}/export`
  )
  return response.data.state
}
