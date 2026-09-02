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
import { IntegrationNotAllowedError } from '@/ee/access-control/utils/permission-check'

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' } as const
const SELECTOR_SCOPE_NOT_FOUND = 'Selector scope not found'

const selectorOperationErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    if (error instanceof SelectorContextUnavailableError) {
      return internalErrorResponse(400, { error: 'Context unavailable' }, PRIVATE_NO_STORE)
    }
    if (error instanceof SelectorConnectionUnavailableError) {
      return internalErrorResponse(
        error.status,
        { error: 'Connection unavailable' },
        PRIVATE_NO_STORE
      )
    }
    /**
     * The integration allowlist refusal, which is deliberately the one selector
     * failure that names itself. The other three are normalized so a caller
     * cannot probe a scope or a credential through them; this one reports the
     * caller's OWN permission group against their own workspace, tells them the
     * remedy is an admin changing the allowlist rather than a broken connection,
     * and reveals nothing they could not read off the block toolbar.
     */
    if (error instanceof IntegrationNotAllowedError) {
      return internalErrorResponse(403, { error: error.message }, PRIVATE_NO_STORE)
    }
    if (error instanceof SelectorOptionsUnavailableError) {
      return internalErrorResponse(
        error.status,
        { error: error.status === 429 ? 'Options temporarily unavailable' : 'Options unavailable' },
        PRIVATE_NO_STORE
      )
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
  rateLimit: internalRateLimits.user({ bucketName: 'selectors.execute' }),
  errorPolicy: selectorErrorPolicy,
  parseOptions: { maxBodyBytes: 256 * 1024 },
  mapInput: ({ body }, { request }) => ({ ...body, signal: request.signal, auditRequest: request }),
  useCase: executeSelector,
  staticResponseHeaders: PRIVATE_NO_STORE,
})
