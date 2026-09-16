import { v2ListSelectorContract } from '@/lib/api/contracts/v2/selectors'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2SelectorErrorPolicy } from '@/lib/selectors/api/error-policy'
import { selectorOperations } from '@/lib/selectors/application/operations'
import { listSelector } from '@/lib/selectors/application/paged-selector'

export const POST = defineV2JsonRoute({
  contract: v2ListSelectorContract,
  auth: v2ApiKeyAuth,
  operation: selectorOperations.execute,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SelectorErrorPolicy,
  parseOptions: { maxBodyBytes: 256 * 1024 },
  mapInput: ({ body }) => body,
  useCase: listSelector,
  present: ({ items, nextCursor, truncated }) => ({ data: items, nextCursor, truncated }),
})
