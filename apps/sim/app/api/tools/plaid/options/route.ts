import { plaidOptionsContract } from '@/lib/api/contracts/selectors/plaid'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listPlaidOptions } from '@/lib/credentials/application/list-plaid-options'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { plaidErrorPolicy } from '@/app/api/tools/plaid/error-policy'

export const dynamic = 'force-dynamic'

export const POST = defineInternalJsonRoute({
  contract: plaidOptionsContract,
  auth: internalSessionAuth,
  operation: credentialOperations.read,
  rateLimit: internalRateLimits.none({ reason: 'Bounded editor selector request' }),
  errorPolicy: plaidErrorPolicy,
  parseOptions: { maxBodyBytes: 64 * 1024 },
  mapInput: ({ body }, { request }) => ({ body, signal: request.signal }),
  useCase: listPlaidOptions,
})
