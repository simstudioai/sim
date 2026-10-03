import { listPersonalCredentialsContract } from '@/lib/api/contracts/credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalCredentialErrorPolicy } from '@/lib/credentials/api/route-policies'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { listPersonalCredentials } from '@/lib/credentials/application/personal-credentials'

export const GET = defineInternalJsonRoute({
  contract: listPersonalCredentialsContract,
  auth: internalSessionAuth,
  operation: credentialOperations.listPersonal,
  rateLimit: internalRateLimits.user({ bucketName: 'credentials.personal.list' }),
  errorPolicy: internalCredentialErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listPersonalCredentials,
  present: ({ credentials }) => ({
    credentials: credentials.map((entry) => ({
      ...entry,
      updatedAt: entry.updatedAt.toISOString(),
      connectedAt: entry.connectedAt.toISOString(),
    })),
  }),
})
