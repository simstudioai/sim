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
  mapInput: ({ params, query }) => ({ organizationId: params.id, url: query.url }),
  useCase: removeSearchHistorySource,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
