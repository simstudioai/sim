import {
  v2DeleteSearchSourceContract,
  v2GetSearchSourceContract,
  v2UpdateSearchSourceContract,
} from '@/lib/api/contracts/v2/search-sources'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { toV2SearchSource } from '@/lib/knowledge/api/search-source-presenter'
import {
  deleteManagedSearchSource,
  readManagedSearchSource,
  updateManagedSearchSource,
} from '@/lib/knowledge/application/manage-search-sources'
import { searchSourceOperations } from '@/lib/knowledge/application/operations'

export const GET = defineV2JsonRoute({
  contract: v2GetSearchSourceContract,
  operation: searchSourceOperations.read,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: readManagedSearchSource,
  present: ({ connector }) => ({ data: toV2SearchSource(connector) }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateSearchSourceContract,
  operation: searchSourceOperations.update,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, updates: body }),
  useCase: updateManagedSearchSource,
  present: ({ connector }) => ({ data: toV2SearchSource(connector) }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteSearchSourceContract,
  operation: searchSourceOperations.delete,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: deleteManagedSearchSource,
  present: ({ connectorId }) => ({ data: { id: connectorId, deleted: true as const } }),
})
