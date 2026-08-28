import { executeSelectorContract } from '@/lib/api/contracts/selectors/execute'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { executeSelector } from '@/lib/selectors/application/execute-selector'
import { selectorOperations } from '@/lib/selectors/application/operations'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' } as const

const selectorErrorPolicy = extendInternalErrorPolicy(internalOrchestrationErrorPolicy, (error) => {
  if (error instanceof SelectorContextUnavailableError) {
    return internalErrorResponse(400, { error: 'Context unavailable' }, PRIVATE_NO_STORE)
  }
  if (error instanceof SelectorConnectionUnavailableError) {
    return internalErrorResponse(403, { error: 'Connection unavailable' }, PRIVATE_NO_STORE)
  }
  if (error instanceof SelectorOptionsUnavailableError) {
    return internalErrorResponse(502, { error: 'Options unavailable' }, PRIVATE_NO_STORE)
  }
  return null
})

export const POST = defineInternalJsonRoute({
  contract: executeSelectorContract,
  auth: internalSessionAuth,
  operation: selectorOperations.execute,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing dynamic selector request behavior during the server migration',
  }),
  errorPolicy: selectorErrorPolicy,
  parseOptions: { maxBodyBytes: 256 * 1024 },
  mapInput: ({ body }, { request }) => ({ ...body, signal: request.signal }),
  useCase: executeSelector,
  staticResponseHeaders: PRIVATE_NO_STORE,
})
