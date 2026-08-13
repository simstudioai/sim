import { netsuiteObjectsSelectorContract } from '@/lib/api/contracts/selectors/netsuite'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { listNetSuiteSelectorObjects } from '@/lib/netsuite/application/list-selector-objects'
import { netsuiteOperations } from '@/lib/netsuite/application/operations'

export const dynamic = 'force-dynamic'

const netsuiteSelectorErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    const classified = asOrchestrationError(error)
    return classified?.code === 'unauthorized'
      ? internalErrorResponse(401, { error: classified.message, authRequired: true })
      : null
  }
)

export const POST = defineInternalJsonRoute({
  contract: netsuiteObjectsSelectorContract,
  auth: internalSessionAuth,
  operation: netsuiteOperations.listSelectorObjects,
  rateLimit: internalRateLimits.none({
    reason:
      'Editor picker reads are session-authenticated and bounded to one NetSuite metadata request',
  }),
  errorPolicy: netsuiteSelectorErrorPolicy,
  parseOptions: { maxBodyBytes: 16 * 1024 },
  mapInput: ({ body }, { request }) => ({ ...body, signal: request.signal }),
  useCase: listNetSuiteSelectorObjects,
  present: ({ objects }) => ({ objects }),
})
