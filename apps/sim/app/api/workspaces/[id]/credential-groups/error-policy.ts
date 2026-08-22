import {
  createInternalResourceConcealmentPolicy,
  type InternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { CredentialGroupEnrollmentError } from '@/lib/credential-groups/enrollments'
import { CredentialGroupProviderConfigurationError } from '@/lib/credential-groups/provider-adapter'
import { CredentialGroupInvitationRateLimitError } from '@/lib/credential-groups/rate-limit'

export function createCredentialGroupInternalErrorPolicy(
  unhandledMessage: string,
  notFoundMessage = 'Credential group not found'
): InternalErrorPolicy {
  if (!unhandledMessage.trim()) {
    throw new Error('Credential Group error policy requires an unhandled message')
  }
  const base: InternalErrorPolicy = {
    project(error) {
      if (error instanceof CredentialGroupProviderConfigurationError) {
        return internalErrorResponse(503, { error: error.message })
      }
      if (error instanceof CredentialGroupEnrollmentError) {
        return internalErrorResponse(error.status, { error: error.message })
      }
      if (error instanceof CredentialGroupInvitationRateLimitError) {
        return internalErrorResponse(
          429,
          { error: error.message, retryAfter: error.resetAt.getTime() },
          {
            'Retry-After': String(error.retryAfterSeconds),
            'X-RateLimit-Reset': error.resetAt.toISOString(),
          }
        )
      }
      return internalOrchestrationErrorPolicy.project(error)
    },
    unhandled() {
      return internalErrorResponse(500, { error: unhandledMessage })
    },
  }
  return createInternalResourceConcealmentPolicy({ base, notFoundMessage })
}
