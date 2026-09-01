import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import {
  getWorkflowDeploymentVersion,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export type WorkflowStateReference = number | 'live' | 'draft'

export interface ResolvedWorkflowStateReference {
  state: WorkflowState
  ref: string
  version?: number
  isActive?: boolean
  createdAt?: string
}

export interface ReadWorkflowStateReferencesInput {
  workflowId: string
  assertedWorkspaceId?: string
  references: [WorkflowStateReference, WorkflowStateReference]
}

async function loadReference(
  workflowId: string,
  reference: WorkflowStateReference
): Promise<ResolvedWorkflowStateReference> {
  if (reference === 'draft') {
    const state = await loadWorkflowFromNormalizedTables(workflowId)
    if (!state) throw new OrchestrationError('not_found', 'Workflow has no draft state')
    return { state: state as WorkflowState, ref: 'draft' }
  }

  const row = await getWorkflowDeploymentVersion(
    workflowId,
    reference === 'live' ? 'active' : reference
  )
  if (!row?.state) throw new OrchestrationError('not_found', 'Deployment version not found')
  return {
    state: row.state as WorkflowState,
    ref: reference === 'live' ? 'live' : String(reference),
    version: row.version,
    isActive: row.isActive,
    createdAt: row.createdAt?.toISOString(),
  }
}

export const readWorkflowStateReferences = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.compareReferences,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadWorkflowStateReferencesInput
  }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ input, context }) {
    const [first, second] = await Promise.all(
      input.references.map((reference) => loadReference(context.workflowId, reference))
    )
    return { references: [first, second] as const }
  },
})
