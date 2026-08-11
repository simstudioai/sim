import {
  createInternalSessionOrExecutorAuth,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'

export const internalSessionOrExecutorAuth = createInternalSessionOrExecutorAuth({
  audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
  resourceScope: (params) => {
    const fileId = typeof params.fileId === 'string' ? params.fileId : undefined
    return fileId ? { fileId } : undefined
  },
})

export const v2FileErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
} as const
