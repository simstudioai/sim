import {
  createInternalSessionOrExecutorAuth,
  type V2ErrorPolicy,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

export const internalSessionOrExecutorAuth = createInternalSessionOrExecutorAuth({
  audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
  resourceScope: (params) => {
    const fileId = typeof params.fileId === 'string' ? params.fileId : undefined
    return fileId ? { fileId } : undefined
  },
})

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
