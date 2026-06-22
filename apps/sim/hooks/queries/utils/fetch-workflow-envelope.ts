import { requestJson } from '@/lib/api/client/request'
import {
  type GetWorkflowResponseData,
  getWorkflowStateContract,
} from '@/lib/api/contracts/workflows'

/**
 * Fetches the full workflow envelope (in-state slice, deployment status,
 * variables, and row metadata) for a single workflow from GET
 * `/api/workflows/[id]`.
 *
 * Single source of truth for the `workflowKeys.state(id)` cache entry: the
 * registry store hydrates it via `fetchQuery` (always-fresh, in-flight
 * deduped) and `useWorkflowState`/`useWorkflowStates` project the mapped
 * `WorkflowState` out of the same entry with `select`, so this endpoint has
 * exactly one cache entry across the store and the hooks.
 *
 * Lives in a standalone util (rather than `hooks/queries/workflows.ts`) so the
 * registry store can import it without creating a store ↔ query-hook import
 * cycle.
 */
export async function fetchWorkflowEnvelope(
  workflowId: string,
  signal?: AbortSignal
): Promise<GetWorkflowResponseData> {
  const { data } = await requestJson(getWorkflowStateContract, {
    params: { id: workflowId },
    signal,
  })
  return data
}
