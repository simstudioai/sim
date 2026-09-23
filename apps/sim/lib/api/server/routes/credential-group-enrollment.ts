import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes/internal-json-route'
import { CredentialGroupEnrollmentError } from '@/lib/credential-groups/enrollments'

export const credentialGroupEnrollmentErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    if (error instanceof CredentialGroupEnrollmentError)
      return internalErrorResponse(error.status, {
        error: error.status >= 500 ? 'Unable to update enrollment' : error.message,
      })
    return null
  }
)
