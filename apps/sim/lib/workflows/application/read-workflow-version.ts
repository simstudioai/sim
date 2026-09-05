import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { projectLegacySlackV2Auth } from '@/lib/workflows/compatibility/slack-v2-auth'
import { sanitizeWorkflowForSharing } from '@/lib/workflows/credentials/credential-extractor'
import { getWorkflowDeploymentVersion } from '@/lib/workflows/persistence/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('ReadWorkflowVersion')

function isWorkflowState(value: unknown): value is WorkflowState {
  return typeof value === 'object' && value !== null
}

/**
 * Strips credentials out of a pinned deployment graph before it leaves the process.
 *
 * `preserveEnvVars` keeps `{{VAR}}` references: those name a workspace environment variable
 * rather than carrying its value — resolution happens at execution time — so the reference is
 * not a secret and is what keeps the pinned graph diffable. Literal inline secrets, opaque table
 * cells, sensitive nested tool parameters, and tool parameters without authoritative codec
 * metadata are nulled.
 */
function sanitizeVersionState(state: WorkflowState): WorkflowState {
  const sanitized = sanitizeWorkflowForSharing(state, {
    preserveEnvVars: true,
    redactOpaqueCredentialInputs: true,
  })
  // double-cast-allowed: the sanitizer clones the graph and only nulls sub-block values, so the shape is unchanged, but its widened return type no longer overlaps WorkflowState
  return sanitized as unknown as WorkflowState
}

export interface ReadWorkflowVersionInput {
  workflowId: string
  assertedWorkspaceId?: string
  version: number | 'active'
  /**
   * Serves the pinned graph with credential values intact. Reserved for first-party session
   * surfaces that render the version inside its own workspace UI, which already serve the same
   * values for the draft graph. Every other surface — API keys included — gets the sanitized
   * graph, so a new surface inherits redaction by default.
   */
  includeCredentialValues?: boolean
}

export const readWorkflowVersion = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readVersion,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadWorkflowVersionInput
  }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, input, context }) {
    const version = await getWorkflowDeploymentVersion(context.workflowId, input.version)
    if (!version?.state) {
      throw new OrchestrationError('not_found', 'Deployment version not found')
    }
    const state = version.state
    if (!isWorkflowState(state)) {
      throw new Error('Deployment version contains invalid workflow state')
    }
    const compatibleState = { ...state, blocks: projectLegacySlackV2Auth(state.blocks ?? {}) }
    const presentedState = input.includeCredentialValues
      ? compatibleState
      : sanitizeVersionState(compatibleState)
    logger.info('Read workflow version', {
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      version: input.version,
      principalKind: principal.kind,
      sanitized: input.includeCredentialValues !== true,
    })
    return { version: { ...version, state: presentedState } }
  },
})
