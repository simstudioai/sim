import { executeSelectorContract } from '@/lib/api/contracts/selectors/execute'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  type InternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createInternalResourceConcealmentPolicy } from '@/lib/api/server/routes/resource-concealment'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { executeSelector } from '@/lib/selectors/application/execute-selector'
import { selectorOperations } from '@/lib/selectors/application/operations'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' } as const
const SELECTOR_SCOPE_NOT_FOUND = 'Selector scope not found'

const selectorOperationErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
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
  }
)

/**
 * This route accepts both workflow and workspace scopes, whose canonical loaders
 * use different not-found messages. Normalize those ordinary misses together
 * with concealed cross-tenant denials so neither status nor body reveals whether
 * a caller-supplied scope exists.
 */
const selectorScopeNotFoundPolicy: InternalErrorPolicy = {
  project(error) {
    if (asOrchestrationError(error)?.code === 'not_found') {
      return internalErrorResponse(404, { error: SELECTOR_SCOPE_NOT_FOUND }, PRIVATE_NO_STORE)
    }
    return selectorOperationErrorPolicy.project(error)
  },
  unhandled: selectorOperationErrorPolicy.unhandled,
}

const selectorErrorPolicy = createInternalResourceConcealmentPolicy({
  base: selectorScopeNotFoundPolicy,
  notFoundMessage: SELECTOR_SCOPE_NOT_FOUND,
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
