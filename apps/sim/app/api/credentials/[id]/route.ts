import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { updateWorkspaceCredentialContract } from '@/lib/api/contracts/credentials'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { type CredentialActorContext, getCredentialActorContext } from '@/lib/credentials/access'
import { performDeleteCredential, performUpdateCredential } from '@/lib/credentials/orchestration'

const logger = createLogger('CredentialByIdAPI')

function formatCredentialResponse(access: CredentialActorContext) {
  const cred = access.credential
  if (!cred) return null

  return {
    id: cred.id,
    workspaceId: cred.workspaceId,
    type: cred.type,
    displayName: cred.displayName,
    description: cred.description,
    providerId: cred.providerId,
    accountId: cred.accountId,
    envKey: cred.envKey,
    envOwnerUserId: cred.envOwnerUserId,
    createdBy: cred.createdBy,
    createdAt: cred.createdAt,
    updatedAt: cred.updatedAt,
    role: access.isAdmin ? 'admin' : (access.member?.role ?? null),
    status: access.member?.status ?? (access.isAdmin ? 'active' : null),
  }
}

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    try {
      const access = await getCredentialActorContext(id, session.user.id)
      if (!access.credential) {
        return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
      }
      if (!access.hasWorkspaceAccess || (!access.member && !access.isAdmin)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      return NextResponse.json({ credential: formatCredentialResponse(access) }, { status: 200 })
    } catch (error) {
      logger.error('Failed to fetch credential', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const parsed = await parseRequest(updateWorkspaceCredentialContract, request, context, {
        validationErrorResponse: (error) =>
          NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
      const body = parsed.data.body

      const result = await performUpdateCredential({
        credentialId: id,
        userId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        displayName: body.displayName,
        description: body.description,
        serviceAccountJson: body.serviceAccountJson,
        signingSecret: body.signingSecret,
        botToken: body.botToken,
        apiToken: body.apiToken,
        domain: body.domain,
        request,
      })
      if (!result.success) {
        const status =
          result.errorCode === 'not_found'
            ? 404
            : result.errorCode === 'forbidden'
              ? 403
              : result.errorCode === 'conflict'
                ? 409
                : result.errorCode === 'validation'
                  ? 400
                  : 500
        return NextResponse.json({ error: result.error }, { status })
      }

      const access = await getCredentialActorContext(id, session.user.id)
      return NextResponse.json({ credential: formatCredentialResponse(access) }, { status: 200 })
    } catch (error) {
      logger.error('Failed to update credential', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    try {
      const result = await performDeleteCredential({
        credentialId: id,
        userId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        request,
      })
      if (!result.success) {
        const status =
          result.errorCode === 'not_found'
            ? 404
            : result.errorCode === 'forbidden'
              ? 403
              : result.errorCode === 'validation'
                ? 400
                : 500
        return NextResponse.json({ error: result.error }, { status })
      }

      return NextResponse.json({ success: true }, { status: 200 })
    } catch (error) {
      logger.error('Failed to delete credential', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
