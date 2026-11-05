import { removeSearchHistorySourceContract } from '@/lib/api/contracts/knowledge/search-history'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  removeSearchHistorySource,
  searchHistoryOperations,
} from '@/lib/knowledge/application/search-history'

export const DELETE = defineInternalJsonRoute({
  contract: removeSearchHistorySourceContract,
  auth: internalSessionAuth,
  operation: searchHistoryOperations.removeSource,
  rateLimit: internalRateLimits.user({ bucketName: 'search-history-write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: { maxBodyBytes: 24 * 1024 },
  mapInput: ({ params, body }) => ({ organizationId: params.id, url: body.url }),
  useCase: removeSearchHistorySource,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
