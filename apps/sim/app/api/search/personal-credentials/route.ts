import {
  removeSearchPersonalCredentialContract,
  saveSearchPersonalCredentialContract,
} from '@/lib/api/contracts/search-personal-credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  internalCredentialErrorPolicy,
  internalPersonalCredentialConnectionErrorPolicy,
} from '@/lib/credentials/api/route-policies'
import {
  removeSearchPersonalCredential,
  saveSearchPersonalCredential,
} from '@/lib/credentials/application/search-personal-credentials'

export const POST = defineInternalJsonRoute({
  contract: saveSearchPersonalCredentialContract,
  auth: internalSessionAuth,
  operation: saveSearchPersonalCredential.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'search-personal-credentials' }),
  errorPolicy: internalPersonalCredentialConnectionErrorPolicy,
  parseOptions: { maxBodyBytes: 16_384 },
  mapInput: ({ body }) => body,
  useCase: saveSearchPersonalCredential,
})

export const DELETE = defineInternalJsonRoute({
  contract: removeSearchPersonalCredentialContract,
  auth: internalSessionAuth,
  operation: removeSearchPersonalCredential.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'search-personal-credentials' }),
  errorPolicy: internalCredentialErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: removeSearchPersonalCredential,
})
