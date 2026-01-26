import { db } from '@sim/db'
import { account, credentialSet, credentialSetMembership } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, like, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { syncAllWebhooksForCredentialSet } from '@/lib/webhooks/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthDisconnectAPI')

const disconnectSchema = z.object({
  provider: z.string().min(1, 'Provider is required'),
  providerId: z.string().optional(),
})

/**
 * Disconnect an OAuth provider for the current user
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated disconnect request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const rawBody = await request.json()
    const parseResult = disconnectSchema.safeParse(rawBody)

    if (!parseResult.success) {
      const issues =
        parseResult.error.issues ?? (parseResult.error as { errors?: z.ZodIssue[] }).errors ?? []
      const firstError = issues[0]
      const errorMessage = firstError?.message || 'Validation failed'
      const normalizedMessage =
        firstError?.code === 'invalid_type' && firstError.path?.[0] === 'provider'
          ? 'Provider is required'
          : errorMessage

      logger.warn(`[${requestId}] Invalid disconnect request`, {
        errors: issues,
      })

      return NextResponse.json(
        {
          error: normalizedMessage,
        },
        { status: 400 }
      )
    }

    const { provider, providerId } = parseResult.data

    logger.info(`[${requestId}] Processing OAuth disconnect request`, {
      provider,
      hasProviderId: !!providerId,
    })

    // If a specific providerId is provided, delete only that account
    if (providerId) {
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
        id: credentialSetMembership.id,
        credentialSetId: credentialSetMembership.credentialSetId,
        providerId: credentialSet.providerId,
      })
      .from(credentialSetMembership)
      .innerJoin(credentialSet, eq(credentialSetMembership.credentialSetId, credentialSet.id))
      .where(
        and(
          eq(credentialSetMembership.userId, session.user.id),
          eq(credentialSetMembership.status, 'active')
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

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error disconnecting OAuth provider`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
