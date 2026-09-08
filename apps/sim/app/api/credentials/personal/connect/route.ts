import { startPersonalCredentialConnectionContract } from '@/lib/api/contracts/credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalPersonalCredentialConnectionErrorPolicy } from '@/lib/credentials/api/route-policies'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { startPersonalCredentialConnection } from '@/lib/credentials/application/personal-connection'

export const POST = defineInternalJsonRoute({
  contract: startPersonalCredentialConnectionContract,
  auth: internalSessionAuth,
  operation: credentialOperations.startPersonalConnection,
  rateLimit: internalRateLimits.user({ bucketName: 'credentials.personal.connect' }),
  errorPolicy: internalPersonalCredentialConnectionErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: startPersonalCredentialConnection,
  present: (result) => result,
})
