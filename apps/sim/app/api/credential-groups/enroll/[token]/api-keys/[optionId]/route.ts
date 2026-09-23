import type { CredentialGroupEnrollmentPrincipal, Principal } from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import {
  deleteCredentialGroupApiKeyContract,
  saveCredentialGroupApiKeyContract,
} from '@/lib/api/contracts/credential-groups'
import { defineInternalJsonRoute, InternalUnauthenticatedError } from '@/lib/api/server/routes'
import { credentialGroupEnrollmentErrorPolicy } from '@/lib/api/server/routes/credential-group-enrollment'
import { enforceUserRateLimit } from '@/lib/core/rate-limiter'
import { authenticateCredentialGroupEnrollment } from '@/lib/credential-groups/application/enrollment-auth'
import { credentialGroupEnrollmentOperations } from '@/lib/credential-groups/application/enrollment-operations'
import {
  deletePublicCredentialGroupApiKey,
  savePublicCredentialGroupApiKey,
} from '@/lib/credential-groups/application/public-enrollment'

const auth = {
  async authenticate(
    _request: NextRequest,
    params: Record<string, string | string[] | undefined>
  ): Promise<CredentialGroupEnrollmentPrincipal> {
    const principal =
      typeof params.token === 'string'
        ? await authenticateCredentialGroupEnrollment(params.token)
        : null
    if (!principal) throw new InternalUnauthenticatedError('Sign in using a valid invitation')
    return principal
  },
}

const rateLimit = {
  kind: 'user' as const,
  bucketName: 'credential-group-api-key',
  async enforce(_request: NextRequest, principal: Principal) {
    if (principal.kind !== 'credential_group_enrollment')
      throw new Error('API key submission requires enrollment authority')
    return enforceUserRateLimit('credential-group-api-key', principal.userId, {
      maxTokens: 60,
      refillRate: 60,
      refillIntervalMs: 60_000,
    })
  },
}

export const PUT = defineInternalJsonRoute({
  contract: saveCredentialGroupApiKeyContract,
  auth,
  rateLimit,
  operation: credentialGroupEnrollmentOperations.saveApiKey,
  errorPolicy: credentialGroupEnrollmentErrorPolicy,
  parseOptions: { maxBodyBytes: 32 * 1024 },
  mapInput: ({ params, body }) => ({ optionId: params.optionId, value: body.value }),
  useCase: savePublicCredentialGroupApiKey,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteCredentialGroupApiKeyContract,
  auth,
  rateLimit,
  operation: credentialGroupEnrollmentOperations.deleteApiKey,
  errorPolicy: credentialGroupEnrollmentErrorPolicy,
  mapInput: ({ params }) => ({ optionId: params.optionId }),
  useCase: deletePublicCredentialGroupApiKey,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
