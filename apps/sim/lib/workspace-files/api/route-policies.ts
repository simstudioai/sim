import {
  createInternalSessionOrExecutorAuth,
  createV2ResourceConcealmentPolicy,
  type V2ErrorPolicy,
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

/**
 * Generated-document serving authorizes the root file and every referenced input. Its executor
 * Principal is therefore intentionally workspace-scoped; a file-scoped Principal could authorize
 * the root or one dependency, but never the full dependency graph.
 */
export const internalWorkspaceFileServeAuth = createInternalSessionOrExecutorAuth({
  audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
})

export const v2FileErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
  concealResourceAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'File not found',
  }) satisfies V2ErrorPolicy,
  /**
   * Resource-ID upload controls conceal the *authorization* failure as absence,
   * so a caller holding a valid API key learns nothing about an upload session
   * belonging to a workspace it cannot reach. Workspace-policy denials keep
   * their own `403`.
   */
  concealUploadAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Upload session not found',
  }) satisfies V2ErrorPolicy,
} as const
