import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { inviteCredentialGroupEnrollmentsContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authorizeCredentialGroupSettings,
  CredentialGroupAccessError,
} from '@/lib/credential-groups/access'
import {
  CredentialGroupEnrollmentError,
  inviteCredentialGroupEnrollments,
} from '@/lib/credential-groups/enrollments'
import { enforceCredentialGroupInvitationRateLimit } from '@/lib/credential-groups/rate-limit'

const logger = createLogger('CredentialGroupEnrollmentsAPI')

type RouteContext = { params: Promise<{ id: string; groupId: string }> }

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(inviteCredentialGroupEnrollmentsContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    await authorizeCredentialGroupSettings(parsed.data.params.id, session.user.id)
    const rateLimited = await enforceCredentialGroupInvitationRateLimit(parsed.data.params.id)
    if (rateLimited) return rateLimited
    const inviterName = session.user.name?.trim() || session.user.email
    if (!inviterName) {
      return NextResponse.json({ error: 'Inviting user has no display identity' }, { status: 409 })
    }
    const result = await inviteCredentialGroupEnrollments(
      parsed.data.params.id,
      parsed.data.params.groupId,
      session.user.id,
      inviterName,
      parsed.data.body
    )
    return NextResponse.json(result)
  } catch (error) {
    if (
      error instanceof CredentialGroupAccessError ||
      error instanceof CredentialGroupEnrollmentError
    ) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error('Failed to invite credential group enrollments', error)
    return NextResponse.json(
      { error: 'Failed to invite credential group enrollments' },
      { status: 500 }
    )
  }
})
