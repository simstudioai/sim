import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  deleteCredentialGroupContract,
  getCredentialGroupContract,
  updateCredentialGroupContract,
} from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authorizeCredentialGroupSettings,
  CredentialGroupAccessError,
} from '@/lib/credential-groups/access'
import {
  CredentialGroupEnrollmentError,
  listCredentialGroupEnrollments,
} from '@/lib/credential-groups/enrollments'
import { CredentialGroupProviderConfigurationError } from '@/lib/credential-groups/provider-adapter'
import {
  deleteCredentialGroup,
  getCredentialGroup,
  updateCredentialGroup,
} from '@/lib/credential-groups/service'

const logger = createLogger('CredentialGroupAPI')

type RouteContext = { params: Promise<{ id: string; groupId: string }> }

export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(getCredentialGroupContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    await authorizeCredentialGroupSettings(parsed.data.params.id, session.user.id)
    const credentialGroup = await getCredentialGroup(
      parsed.data.params.id,
      parsed.data.params.groupId
    )
    if (!credentialGroup) {
      return NextResponse.json({ error: 'Credential group not found' }, { status: 404 })
    }
    const enrollmentPage = await listCredentialGroupEnrollments(
      parsed.data.params.id,
      parsed.data.params.groupId,
      parsed.data.query.limit,
      parsed.data.query.cursor
    )
    return NextResponse.json({ credentialGroup, ...enrollmentPage })
  } catch (error) {
    if (
      error instanceof CredentialGroupAccessError ||
      error instanceof CredentialGroupEnrollmentError
    ) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error('Failed to get credential group', error)
    return NextResponse.json({ error: 'Failed to get credential group' }, { status: 500 })
  }
})

export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(updateCredentialGroupContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    await authorizeCredentialGroupSettings(parsed.data.params.id, session.user.id)
    const updated = await updateCredentialGroup(
      parsed.data.params.id,
      parsed.data.params.groupId,
      parsed.data.body
    )
    if (!updated) return NextResponse.json({ error: 'Credential group not found' }, { status: 404 })
    return NextResponse.json({ credentialGroup: updated })
  } catch (error) {
    if (error instanceof CredentialGroupAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (getPostgresErrorCode(error) === '23505') {
      return NextResponse.json(
        { error: 'A credential group with this name already exists' },
        { status: 409 }
      )
    }
    if (error instanceof CredentialGroupProviderConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    logger.error('Failed to update credential group', error)
    return NextResponse.json({ error: 'Failed to update credential group' }, { status: 500 })
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(deleteCredentialGroupContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    await authorizeCredentialGroupSettings(parsed.data.params.id, session.user.id)
    const deleted = await deleteCredentialGroup(parsed.data.params.id, parsed.data.params.groupId)
    if (!deleted) return NextResponse.json({ error: 'Credential group not found' }, { status: 404 })
    return NextResponse.json({ success: true as const })
  } catch (error) {
    if (error instanceof CredentialGroupAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error('Failed to delete credential group', error)
    return NextResponse.json({ error: 'Failed to delete credential group' }, { status: 500 })
  }
})
