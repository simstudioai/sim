import { executeCopilotWorkflowUseCase } from '@/lib/copilot/application/execute-workflow-use-case'
import type { ExecutionContext } from '@/lib/copilot/request/types'
import { readWorkflowDefinition } from '@/lib/workflows/application/read-workflow-definition'
import { readWorkflowVersion } from '@/lib/workflows/application/read-workflow-version'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** Canonical workflow-state selector: a deployment version number, the live
 * (active) deployment, or the current draft. */
export type WorkflowRef = number | 'live' | 'draft'

export interface ResolvedWorkflowRef {
  state: WorkflowState
  /** Human-readable ref label: "live", "draft", or the version number as a string. */
  ref: string
  version?: number
  isActive?: boolean
  createdAt?: string
}

/**
 * Parse a raw ref param into a canonical WorkflowRef.
 * Accepts a version number, a numeric string, "live"/"active", or "draft"/"current".
 * Throws on anything else.
 */
export function parseWorkflowRef(raw: unknown): WorkflowRef {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase()
    if (trimmed === 'live' || trimmed === 'active') return 'live'
    if (trimmed === 'draft' || trimmed === 'current') return 'draft'
    if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10)
  }
  throw new Error(`Invalid ref "${String(raw)}": expected a version number, "live", or "draft"`)
}

/**
 * Resolve a (workflowId, ref) pair to a WorkflowState for diffing. Raw stored
 * snapshots are used for version/live (matching checkNeedsRedeployment's baseline),
 * and loadWorkflowDeploymentSnapshot is used for draft. Requires read access.
 */
export async function resolveWorkflowStateRef(
  workflowId: string,
  rawRef: unknown,
  context: ExecutionContext
): Promise<ResolvedWorkflowRef> {
  const ref = parseWorkflowRef(rawRef)

  if (ref === 'draft') {
    const { state } = await executeCopilotWorkflowUseCase(context, readWorkflowDefinition, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      state: 'draft',
    })
    if (!state) {
      throw new Error(`Workflow ${workflowId} has no draft state`)
    }
    return { state: state as WorkflowState, ref: 'draft' }
  }

  const { version: row } = await executeCopilotWorkflowUseCase(context, readWorkflowVersion, {
    workflowId,
    assertedWorkspaceId: context.workspaceId,
    version: ref === 'live' ? 'active' : ref,
  })

  return {
    state: row.state as WorkflowState,
    ref: ref === 'live' ? 'live' : String(ref),
    version: row.version,
    isActive: row.isActive,
    createdAt: row.createdAt?.toISOString(),
  }
}
