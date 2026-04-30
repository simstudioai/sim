import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { account, credentialSet, credentialSetMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, like, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { disconnectOAuthContract } from '@/lib/api/contracts/oauth-connections'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { syncAllWebhooksForCredentialSet } from '@/lib/webhooks/utils.server'

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

    // If a specific account row ID is provided, delete that exact account
    if (accountId) {
      await db
        .delete(account)
        .where(and(eq(account.userId, session.user.id), eq(account.id, accountId)))
    } else if (providerId) {
      // If a specific providerId is provided, delete accounts for that provider ID
      await db
        .delete(account)
        .where(and(eq(account.userId, session.user.id), eq(account.providerId, providerId)))
    } else {
      // Otherwise, delete all accounts for this provider
      // Handle both exact matches (e.g., 'confluence') and prefixed matches (e.g., 'google-email')
      await db
        .delete(account)
        .where(
          and(
            eq(account.userId, session.user.id),
            or(eq(account.providerId, provider), like(account.providerId, `${provider}-%`))
          )
        )
    }

    // Sync webhooks for all credential sets the user is a member of
    // This removes webhooks that were using the disconnected credential
    const userMemberships = await db
      .select({
        id: credentialSetMember.id,
        credentialSetId: credentialSetMember.credentialSetId,
        providerId: credentialSet.providerId,
      })
      .from(credentialSetMember)
      .innerJoin(credentialSet, eq(credentialSetMember.credentialSetId, credentialSet.id))
      .where(
        and(
          eq(credentialSetMember.userId, session.user.id),
          eq(credentialSetMember.status, 'active')
        )
      )

    for (const membership of userMemberships) {
      // Only sync if the credential set matches this provider
      // Credential sets store OAuth provider IDs like 'google-email' or 'outlook'
      const matchesProvider =
        membership.providerId === provider ||
        membership.providerId === providerId ||
        membership.providerId?.startsWith(`${provider}-`)

      if (matchesProvider) {
        try {
          await syncAllWebhooksForCredentialSet(membership.credentialSetId, requestId)
          logger.info(`[${requestId}] Synced webhooks after credential disconnect`, {
            credentialSetId: membership.credentialSetId,
            provider,
          })
        } catch (error) {
          // Log but don't fail the disconnect - credential is already removed
          logger.error(`[${requestId}] Failed to sync webhooks after credential disconnect`, {
            credentialSetId: membership.credentialSetId,
            provider,
            error,
          })
        }
      }
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
