import {
  createInternalSessionOrServiceAuth,
  type V2ErrorPolicy,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

export const internalSessionOrServiceAuth = createInternalSessionOrServiceAuth(
  ({ subjectUserId, params }) => {
    const workspaceId = params.id
    if (typeof workspaceId !== 'string' || !workspaceId) {
      throw new Error('Internal file delegation requires a workspace route parameter')
    }
    return createWorkspaceFileDelegatedPrincipal({
      serviceId: 'executor',
      subjectUserId,
      workspaceId,
      delegationId: `internal-file:${subjectUserId}`,
      fileId: typeof params.fileId === 'string' ? params.fileId : undefined,
    })
  }
)

export const v2FileErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
  concealResourceAuthorization: {
    render(error) {
      const response = v2CaughtOrchestrationError(error)
      if (!response) return null
      if (response.status === 403) return v2Error('NOT_FOUND', 'File not found')
      return response
    },
  } satisfies V2ErrorPolicy,
} as const
