import type {
  PersonalApiKeyPrincipal,
  Principal,
  SessionPrincipal,
  WorkspaceApiKeyPrincipal,
} from '@sim/auth/principal'
import {
  createInternalResourceConcealmentPolicy,
  createInternalSessionOrExecutorAuth,
  createV2ResourceConcealmentPolicy,
  type InternalAuthPolicy,
  type InternalErrorPolicy,
  InternalUnauthenticatedError,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalSessionAuth,
  type V2ErrorPolicy,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { WORKFLOW_DELEGATION_AUDIENCE } from '@/lib/workflows/application/authorization'
import { WorkflowImportError } from '@/lib/workflows/application/workflow-import-error'
import { WorkflowOperationsNotAppliedError } from '@/lib/workflows/application/workflow-operations-error'
import { v2CaughtOrchestrationError, v2ErrorForOrchestration } from '@/app/api/v2/lib/response'

export const v2WorkflowErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
  import: {
    render(error) {
      if (error instanceof WorkflowImportError) {
        return v2ErrorForOrchestration(error.code, error.message, error.details)
      }
      return v2CaughtOrchestrationError(error)
    },
  } satisfies V2ErrorPolicy,
  concealWorkflowAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Workflow not found',
  }),
  /**
   * Conceals cross-tenant reads exactly as
   * {@link v2WorkflowErrorPolicies.concealWorkflowAuthorization} does, and adds
   * the one refusal an edit batch has structured detail for: an `atomic` batch
   * that could not be applied whole answers `409` carrying the declined
   * operations and the block inputs that would have been dropped, so a pipeline
   * can act on both without a second request.
   */
  concealWorkflowGraphAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Workflow not found',
    render(error) {
      if (error instanceof WorkflowOperationsNotAppliedError) {
        return v2ErrorForOrchestration(error.code, error.message, {
          code: 'OPERATIONS_NOT_APPLIED',
          skipped: error.skipped,
          droppedInputs: error.droppedInputs,
        })
      }
      return v2CaughtOrchestrationError(error)
    },
  }),
  concealRunAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Run not found',
  }),
} as const

export const internalWorkflowSessionOrExecutorAuth = createInternalSessionOrExecutorAuth({
  audience: WORKFLOW_DELEGATION_AUDIENCE,
})

type WorkflowApiKeyPrincipal = PersonalApiKeyPrincipal | WorkspaceApiKeyPrincipal

async function authenticateWorkflowApiKey(rawApiKey: string): Promise<WorkflowApiKeyPrincipal> {
  const result = await authenticateApiKeyFromHeader(rawApiKey)
  if (!result.success || !result.keyId || !result.keyType) {
    throw new InternalUnauthenticatedError('Unauthorized')
  }
  await updateApiKeyLastUsed(result.keyId)

  if (result.keyType === 'workspace') {
    if (!result.workspaceId) throw new Error('Workspace API key is missing its workspace scope')
    return { kind: 'workspace_api_key', workspaceId: result.workspaceId, keyId: result.keyId }
  }
  if (!result.userId) throw new Error('Personal API key is missing its credential owner')
  return { kind: 'personal_api_key', userId: result.userId, keyId: result.keyId }
}

export const internalWorkflowSessionOrApiKeyAuth: InternalAuthPolicy<
  SessionPrincipal | WorkflowApiKeyPrincipal
> = {
  async authenticate(request) {
    const rawApiKey = request.headers.get('x-api-key')
    if (!rawApiKey) return internalSessionAuth.authenticate()
    return authenticateWorkflowApiKey(rawApiKey)
  },
}

export const internalWorkflowReadAuth: InternalAuthPolicy<Principal> = {
  async authenticate(request, params) {
    const rawApiKey = request.headers.get('x-api-key')
    if (!rawApiKey) {
      return internalWorkflowSessionOrExecutorAuth.authenticate(request, params)
    }
    return authenticateWorkflowApiKey(rawApiKey)
  },
}

function legacyWorkflowErrorCode(message: string): string {
  return message.toUpperCase().replace(/\s+/g, '_')
}

export const WORKFLOW_NOT_FOUND_MESSAGE = 'Workflow not found'

/**
 * Every route built on this policy is scoped to a single workflow, so all of
 * them conceal cross-tenant authorization the way their v2 counterparts do.
 */
export function createInternalWorkflowErrorPolicy(fallback: string): InternalErrorPolicy {
  if (!fallback.trim()) throw new Error('Internal workflow error fallback is required')
  return createInternalResourceConcealmentPolicy({
    notFoundMessage: WORKFLOW_NOT_FOUND_MESSAGE,
    base: {
      project(error) {
        const classified = asOrchestrationError(error)
        if (!classified) return null
        return internalErrorResponse(statusForOrchestrationError(classified.code), {
          error: classified.message,
          code: legacyWorkflowErrorCode(classified.message),
        })
      },
      unhandled() {
        return internalErrorResponse(500, {
          error: fallback,
          code: legacyWorkflowErrorCode(fallback),
        })
      },
    },
  })
}

/**
 * Internal-surface counterparts of {@link v2WorkflowErrorPolicies} for the
 * workflow routes that project plain orchestration errors.
 */
export const internalWorkflowErrorPolicies = {
  concealWorkflowAuthorization: createInternalResourceConcealmentPolicy({
    base: internalOrchestrationErrorPolicy,
    notFoundMessage: WORKFLOW_NOT_FOUND_MESSAGE,
  }),
  concealRunAuthorization: createInternalResourceConcealmentPolicy({
    base: internalOrchestrationErrorPolicy,
    notFoundMessage: 'Execution not found',
  }),
} as const
