import { type V2ErrorPolicy, v2OrchestrationErrorPolicy } from '@/lib/api/server/routes'
import {
  DelegatedWorkspaceAuthorizationError,
  InsufficientWorkspacePermissionsError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyAuthorizationError,
} from '@/lib/core/application'
import { WorkflowImportError } from '@/lib/workflows/application/workflow-import-error'
import {
  v2CaughtOrchestrationError,
  v2Error,
  v2ErrorForOrchestration,
} from '@/app/api/v2/lib/response'

function isConcealedResourceAuthorizationError(error: unknown): boolean {
  return (
    error instanceof DelegatedWorkspaceAuthorizationError ||
    error instanceof InsufficientWorkspacePermissionsError ||
    error instanceof PrincipalKindAuthorizationError ||
    error instanceof WorkspaceApiKeyAuthorizationError
  )
}

function concealResourceAuthorization(resourceName: 'Workflow' | 'Run'): V2ErrorPolicy {
  return {
    render(error) {
      if (error instanceof PersonalApiKeysDisabledError) {
        return v2CaughtOrchestrationError(error)
      }
      if (isConcealedResourceAuthorizationError(error)) {
        return v2Error('NOT_FOUND', `${resourceName} not found`)
      }
      return v2CaughtOrchestrationError(error)
    },
  }
}

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
  concealWorkflowAuthorization: concealResourceAuthorization('Workflow'),
  concealRunAuthorization: concealResourceAuthorization('Run'),
} as const
