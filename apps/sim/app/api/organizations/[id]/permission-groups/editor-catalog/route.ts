import { getPermissionGroupEditorCatalogContract } from '@/lib/api/contracts/permission-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalPermissionGroupErrorPolicy } from '@/lib/api/server/routes/permission-groups'
import { readPermissionGroupEditorCatalog } from '@/lib/permission-groups/application/editor-catalog'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'

export const GET = defineInternalJsonRoute({
  contract: getPermissionGroupEditorCatalogContract,
  auth: internalSessionAuth,
  operation: permissionGroupOperations.readEditorCatalog,
  rateLimit: internalRateLimits.none({
    reason: 'A static projection read once per group editor, as the group list it sits beside',
  }),
  errorPolicy: internalPermissionGroupErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: readPermissionGroupEditorCatalog,
})
