import {
  clearSearchHistoryContract,
  listSearchHistoryContract,
  recordSearchHistoryContract,
} from '@/lib/api/contracts/knowledge/search-history'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  clearSearchHistory,
  listSearchHistory,
  recordSearchHistory,
  searchHistoryOperations,
} from '@/lib/knowledge/application/search-history'

export const GET = defineInternalJsonRoute({
  contract: listSearchHistoryContract,
  auth: internalSessionAuth,
  operation: searchHistoryOperations.list,
  rateLimit: internalRateLimits.user({ bucketName: 'search-history-read' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: listSearchHistory,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
export const POST = defineInternalJsonRoute({
  contract: recordSearchHistoryContract,
  auth: internalSessionAuth,
  operation: searchHistoryOperations.record,
  rateLimit: internalRateLimits.user({ bucketName: 'search-history-write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: { maxBodyBytes: 24 * 1024 },
  mapInput: ({ params, body }) => ({ organizationId: params.id, event: body }),
  useCase: recordSearchHistory,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
export const DELETE = defineInternalJsonRoute({
  contract: clearSearchHistoryContract,
  auth: internalSessionAuth,
  operation: searchHistoryOperations.clear,
  rateLimit: internalRateLimits.user({ bucketName: 'search-history-write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: clearSearchHistory,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
