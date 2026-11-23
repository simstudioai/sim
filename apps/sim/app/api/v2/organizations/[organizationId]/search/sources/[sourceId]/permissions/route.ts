import {
  v2GetSearchSourcePermissionsContract,
  v2ReplaceSearchSourcePermissionsContract,
} from '@/lib/api/contracts/v2/organizations'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { searchSourcePermissionOperations } from '@/lib/knowledge/application/operations'
import {
  readSearchSourcePermissions,
  replaceSearchSourcePermissions,
} from '@/lib/knowledge/application/source-permissions'

export const GET = defineV2JsonRoute({
  contract: v2GetSearchSourcePermissionsContract,
  operation: searchSourcePermissionOperations.read,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: readSearchSourcePermissions,
  present: (data) => ({ data }),
})

export const PUT = defineV2JsonRoute({
  contract: v2ReplaceSearchSourcePermissionsContract,
  operation: searchSourcePermissionOperations.replace,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: replaceSearchSourcePermissions,
  present: (data) => ({ data }),
})
