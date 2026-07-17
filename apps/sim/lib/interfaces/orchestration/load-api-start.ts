import {
  type ApiStartInputResult,
  resolveApiStartInput,
} from '@/lib/interfaces/spec/api-start-input'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'

type BlockMap = Record<
  string,
  {
    id?: string
    type: string
    name?: string
    triggerMode?: boolean
    subBlocks?: Record<string, unknown>
  }
>

export async function loadDraftApiStartInput(workflowId: string): Promise<
  | {
      ok: true
      data: ApiStartInputResult
      draft: {
        blocks: BlockMap
        edges: Array<{ source: string; target: string }>
      }
    }
  | { ok: false; error: string }
> {
  const draft = await loadWorkflowFromNormalizedTables(workflowId)
  if (!draft?.blocks) {
    return { ok: false, error: 'Workflow draft not found' }
  }
  const resolved = resolveApiStartInput(draft.blocks as BlockMap)
  if (!resolved.ok) return resolved
  return {
    ok: true,
    data: resolved.data,
    draft: {
      blocks: draft.blocks as BlockMap,
      edges: (draft.edges || []) as Array<{ source: string; target: string }>,
    },
  }
}

export async function loadDeployedApiStartInput(workflowId: string): Promise<
  | {
      ok: true
      data: ApiStartInputResult
      deployed: Awaited<ReturnType<typeof loadDeployedWorkflowState>>
    }
  | { ok: false; error: string }
> {
  try {
    const deployed = await loadDeployedWorkflowState(workflowId)
    const resolved = resolveApiStartInput(deployed.blocks as BlockMap)
    if (!resolved.ok) return resolved
    return { ok: true, data: resolved.data, deployed }
  } catch {
    return { ok: false, error: 'Workflow has no active deployment' }
  }
}
