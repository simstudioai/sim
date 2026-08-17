import type { NextRequest } from 'next/server'
import { completeCredentialGroupEnrollmentContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authenticateCredentialGroupEnrollment } from '@/lib/credential-groups/application/enrollment-auth'
import { completePublicCredentialGroupEnrollment } from '@/lib/credential-groups/application/public-enrollment'
import { enforcePublicCredentialGroupIpRateLimit } from '@/lib/credential-groups/rate-limit'
import {
  createCredentialGroupCompletionRedirect,
  createCredentialGroupEnrollmentRedirect,
} from '@/app/api/credential-groups/enrollment-redirect'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const limited = await enforcePublicCredentialGroupIpRateLimit(request, 'complete')
    if (limited) return limited

    const parsed = await parseRequest(completeCredentialGroupEnrollmentContract, request, context)
    if (!parsed.success) return parsed.response
    const { token } = parsed.data.params
    const principal = await authenticateCredentialGroupEnrollment(token)
    if (!principal) {
      return createCredentialGroupEnrollmentRedirect(token, { oauth: 'unavailable' })
    }
    const completion = await completePublicCredentialGroupEnrollment
      .execute({ principal, input: {}, request })
      .catch((error: unknown) => {
        if (asOrchestrationError(error)?.code === 'not_found') return null
        throw error
      })
    if (!completion) {
      return createCredentialGroupEnrollmentRedirect(token, { oauth: 'unavailable' })
    }
    const { completed } = completion
    if (completed === null) {
      return createCredentialGroupEnrollmentRedirect(token, { oauth: 'unavailable' })
    }
    return createCredentialGroupCompletionRedirect()
  }
)
