import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { revokeCredentialGroupEnrollmentContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authorizeCredentialGroupSettings,
  CredentialGroupAccessError,
} from '@/lib/credential-groups/access'
import {
  CredentialGroupEnrollmentError,
  revokeCredentialGroupEnrollment,
} from '@/lib/credential-groups/enrollments'

const logger = createLogger('CredentialGroupEnrollmentAPI')

type RouteContext = { params: Promise<{ id: string; groupId: string; enrollmentId: string }> }

export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(revokeCredentialGroupEnrollmentContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    await authorizeCredentialGroupSettings(parsed.data.params.id, session.user.id)
    const credentialGroupEnrollment = await revokeCredentialGroupEnrollment(
      parsed.data.params.id,
      parsed.data.params.groupId,
      parsed.data.params.enrollmentId
    )
    return NextResponse.json({ credentialGroupEnrollment })
  } catch (error) {
    if (
      error instanceof CredentialGroupAccessError ||
      error instanceof CredentialGroupEnrollmentError
    ) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error('Failed to revoke credential group enrollment', error)
    return NextResponse.json(
      { error: 'Failed to revoke credential group enrollment' },
      { status: 500 }
    )
  }
})
