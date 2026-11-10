import { prepareWorkloadIdentityContract } from '@/lib/api/contracts/credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalCredentialErrorPolicy } from '@/lib/credentials/api/route-policies'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { prepareWorkloadIdentity } from '@/lib/credentials/application/prepare-workload-identity'

export const POST = defineInternalJsonRoute({
  contract: prepareWorkloadIdentityContract,
  auth: internalSessionAuth,
  operation: credentialOperations.prepareWorkloadIdentity,
  rateLimit: internalRateLimits.user({ bucketName: 'credentials.workload_identity.prepare' }),
  errorPolicy: internalCredentialErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: prepareWorkloadIdentity,
  present: (result) => result,
})
