import {
  v2GetGitLabSearchPermissionsContract,
  v2ReplaceGitLabSearchPermissionsContract,
} from '@/lib/api/contracts/v2/organizations'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { gitLabSearchPermissionOperations } from '@/lib/knowledge/application/gitlab-search-permission-operations'
import {
  readGitLabSearchPermissions,
  replaceGitLabSearchPermissions,
} from '@/lib/knowledge/application/gitlab-search-permissions'

export const GET = defineV2JsonRoute({
  contract: v2GetGitLabSearchPermissionsContract,
  operation: gitLabSearchPermissionOperations.read,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: readGitLabSearchPermissions,
  present: (data) => ({ data }),
})

export const PUT = defineV2JsonRoute({
  contract: v2ReplaceGitLabSearchPermissionsContract,
  operation: gitLabSearchPermissionOperations.replace,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: replaceGitLabSearchPermissions,
  present: (data) => ({ data }),
})
