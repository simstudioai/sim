import {
  v2GetOrganizationAccessRequestSettingsContract,
  v2UpdateOrganizationAccessRequestSettingsContract,
} from '@/lib/api/contracts/v2/access-requests'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2AccessRequestErrorPolicy } from '@/lib/api/server/routes/access-requests'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'
import {
  getAccessRequestSettings,
  updateAccessRequestSettings,
} from '@/ee/access-requests/lib/application/requests'

export const GET = defineV2JsonRoute({
  contract: v2GetOrganizationAccessRequestSettingsContract,
  auth: v2ApiKeyAuth,
  operation: accessRequestOperations.getSettings,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2AccessRequestErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: getAccessRequestSettings,
  present: (settings) => ({ data: settings }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateOrganizationAccessRequestSettingsContract,
  auth: v2ApiKeyAuth,
  operation: accessRequestOperations.updateSettings,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2AccessRequestErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: updateAccessRequestSettings,
  present: (settings) => ({ data: settings }),
})
