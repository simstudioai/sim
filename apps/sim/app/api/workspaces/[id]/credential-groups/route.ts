import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  createCredentialGroupContract,
  listCredentialGroupsContract,
} from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authorizeCredentialGroupSettings,
  CredentialGroupAccessError,
} from '@/lib/credential-groups/access'
import { CredentialGroupProviderConfigurationError } from '@/lib/credential-groups/provider-adapter'
import { createCredentialGroup, listCredentialGroups } from '@/lib/credential-groups/service'

const logger = createLogger('CredentialGroupsAPI')

type RouteContext = { params: Promise<{ id: string }> }

function accessErrorResponse(error: CredentialGroupAccessError) {
  return NextResponse.json({ error: error.message }, { status: error.status })
}

export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(listCredentialGroupsContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    await authorizeCredentialGroupSettings(parsed.data.params.id, session.user.id)
    const credentialGroups = await listCredentialGroups(parsed.data.params.id)
    return NextResponse.json({ credentialGroups })
  } catch (error) {
    if (error instanceof CredentialGroupAccessError) return accessErrorResponse(error)
    logger.error('Failed to list credential groups', error)
    return NextResponse.json({ error: 'Failed to list credential groups' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(createCredentialGroupContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    await authorizeCredentialGroupSettings(parsed.data.params.id, session.user.id)
    const credentialGroup = await createCredentialGroup(
      parsed.data.params.id,
      session.user.id,
      parsed.data.body
    )
    return NextResponse.json({ credentialGroup }, { status: 201 })
  } catch (error) {
    if (error instanceof CredentialGroupAccessError) return accessErrorResponse(error)
    if (getPostgresErrorCode(error) === '23505') {
      return NextResponse.json(
        { error: 'A credential group with this name already exists' },
        { status: 409 }
      )
    }
    if (error instanceof CredentialGroupProviderConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    logger.error('Failed to create credential group', error)
    return NextResponse.json({ error: 'Failed to create credential group' }, { status: 500 })
  }
})
