import type { NextRequest } from 'next/server'
import { completeCredentialGroupEnrollmentContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { completeCredentialGroupEnrollment } from '@/lib/credential-groups/enrollments'
import { enforcePublicCredentialGroupIpRateLimit } from '@/lib/credential-groups/rate-limit'
import { createCredentialGroupEnrollmentRedirect } from '@/app/api/credential-groups/enrollment-redirect'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const limited = await enforcePublicCredentialGroupIpRateLimit(request, 'complete')
    if (limited) return limited

    const parsed = await parseRequest(completeCredentialGroupEnrollmentContract, request, context)
    if (!parsed.success) return parsed.response
    const { token } = parsed.data.params
    const completed = await completeCredentialGroupEnrollment(token)
    if (completed === null) {
      return createCredentialGroupEnrollmentRedirect(token, { oauth: 'unavailable' })
    }
    return createCredentialGroupEnrollmentRedirect(
      token,
      completed ? { submitted: '1' } : { oauth: 'incomplete' }
    )
  }
)
