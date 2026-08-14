import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { resendCredentialGroupEnrollmentContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authorizeCredentialGroupSettings,
  CredentialGroupAccessError,
} from '@/lib/credential-groups/access'
import {
  CredentialGroupEnrollmentError,
  resendCredentialGroupEnrollment,
} from '@/lib/credential-groups/enrollments'
import { enforceCredentialGroupInvitationRateLimit } from '@/lib/credential-groups/rate-limit'

const logger = createLogger('CredentialGroupEnrollmentResendAPI')

type RouteContext = { params: Promise<{ id: string; groupId: string; enrollmentId: string }> }

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(resendCredentialGroupEnrollmentContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    await authorizeCredentialGroupSettings(parsed.data.params.id, session.user.id)
    const rateLimited = await enforceCredentialGroupInvitationRateLimit(parsed.data.params.id)
    if (rateLimited) return rateLimited
    const inviterName = session.user.name?.trim() || session.user.email
    if (!inviterName) {
      return NextResponse.json({ error: 'Inviting user has no display identity' }, { status: 409 })
    }
    const credentialGroupEnrollment = await resendCredentialGroupEnrollment(
      parsed.data.params.id,
      parsed.data.params.groupId,
      parsed.data.params.enrollmentId,
      session.user.id,
      inviterName
    )
    return NextResponse.json({ credentialGroupEnrollment })
  } catch (error) {
    if (
      error instanceof CredentialGroupAccessError ||
      error instanceof CredentialGroupEnrollmentError
    ) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error('Failed to resend credential group enrollment', error)
    return NextResponse.json(
      { error: 'Failed to resend credential group enrollment' },
      { status: 500 }
    )
  }
})
