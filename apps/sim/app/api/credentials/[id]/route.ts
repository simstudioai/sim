import { db } from '@sim/db'
import { credential, credentialMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateWorkspaceCredentialContract } from '@/lib/api/contracts/credentials'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { performDeleteCredential, performUpdateCredential } from '@/lib/credentials/orchestration'

const logger = createLogger('CredentialByIdAPI')

async function getCredentialResponse(credentialId: string, userId: string) {
  const [row] = await db
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      type: credential.type,
      displayName: credential.displayName,
      description: credential.description,
      providerId: credential.providerId,
      accountId: credential.accountId,
      envKey: credential.envKey,
      envOwnerUserId: credential.envOwnerUserId,
      createdBy: credential.createdBy,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      role: credentialMember.role,
      status: credentialMember.status,
    })
    .from(credential)
    .innerJoin(
      credentialMember,
      and(eq(credentialMember.credentialId, credential.id), eq(credentialMember.userId, userId))
    )
    .where(eq(credential.id, credentialId))
    .limit(1)

  return row ?? null
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
      if (!access.hasWorkspaceAccess || !access.member) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const row = await getCredentialResponse(id, session.user.id)
      return NextResponse.json({ credential: row }, { status: 200 })
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

      const row = await getCredentialResponse(id, session.user.id)
      return NextResponse.json({ credential: row }, { status: 200 })
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
