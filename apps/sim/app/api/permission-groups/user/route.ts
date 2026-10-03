import { NextResponse } from 'next/server'
import { getUserPermissionConfigContract } from '@/lib/api/contracts/permission-groups'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { NoWorkspaceAccessError } from '@/lib/core/application/workspace-authorization'
import { permissionGroupWorkspaceOperations } from '@/lib/permission-groups/application/operations'
import { readUserPermissionConfig } from '@/lib/permission-groups/application/read-user-config'

export const GET = defineInternalJsonRoute({
  contract: getUserPermissionConfigContract,
  auth: internalSessionAuth,
  operation: permissionGroupWorkspaceOperations.readUserConfig,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve the existing internal policy read rate.',
  }),
  parseOptions: {
    validationErrorResponse: () =>
      NextResponse.json({ error: 'workspaceId is required' }, { status: 400 }),
  },
  errorPolicy: extendInternalErrorPolicy(internalOrchestrationErrorPolicy, (error) =>
    error instanceof NoWorkspaceAccessError
      ? internalErrorResponse(403, { error: 'Not a member of this workspace' })
      : null
  ),
  mapInput: ({ query }) => query,
  useCase: readUserPermissionConfig,
})
