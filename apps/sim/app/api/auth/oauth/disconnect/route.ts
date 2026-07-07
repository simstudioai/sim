import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { account, credential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, like, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { disconnectOAuthContract } from '@/lib/api/contracts/oauth-connections'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deleteCredential } from '@/lib/credentials/deletion'
import { captureServerEvent } from '@/lib/posthog/server'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthDisconnectAPI')

/**
 * Disconnect an OAuth provider for the current user
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated disconnect request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const parsed = await parseRequest(
      disconnectOAuthContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid disconnect request`, { errors: error.issues })
          return NextResponse.json(
            { error: getValidationErrorMessage(error, 'Validation failed') },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { provider, providerId, accountId } = parsed.data.body

    logger.info(`[${requestId}] Processing OAuth disconnect request`, {
      provider,
      hasProviderId: !!providerId,
    })

    // Delete credentials before their accounts so deleteCredential can clear
    // stored references first. Otherwise FK CASCADE would orphan them silently.
    const accountFilter = accountId
      ? and(eq(account.userId, session.user.id), eq(account.id, accountId))
      : providerId
        ? and(eq(account.userId, session.user.id), eq(account.providerId, providerId))
        : and(
            eq(account.userId, session.user.id),
            or(eq(account.providerId, provider), like(account.providerId, `${provider}-%`))
          )

    const targetAccounts = await db.select({ id: account.id }).from(account).where(accountFilter)

    const targetAccountIds = targetAccounts.map((a) => a.id)

    if (targetAccountIds.length > 0) {
      const credentialsToDelete = await db
        .select({
          id: credential.id,
          workspaceId: credential.workspaceId,
          providerId: credential.providerId,
        })
        .from(credential)
        .where(inArray(credential.accountId, targetAccountIds))

      for (const cred of credentialsToDelete) {
        await deleteCredential({
          credentialId: cred.id,
          actorId: session.user.id,
          actorName: session.user.name,
          actorEmail: session.user.email,
          reason: 'oauth_disconnect',
          request,
        })

        captureServerEvent(
          session.user.id,
          'credential_deleted',
          {
            credential_type: 'oauth',
            provider_id: cred.providerId ?? providerId ?? provider,
            workspace_id: cred.workspaceId,
          },
          { groups: { workspace: cred.workspaceId } }
        )
      }

      await db.delete(account).where(inArray(account.id, targetAccountIds))
    }

    recordAudit({
      workspaceId: null,
      actorId: session.user.id,
      action: AuditAction.OAUTH_DISCONNECTED,
      resourceType: AuditResourceType.OAUTH,
      resourceId: providerId ?? provider,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: provider,
      description: `Disconnected OAuth provider: ${provider}`,
      metadata: { provider, providerId },
      request,
    })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error disconnecting OAuth provider`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
