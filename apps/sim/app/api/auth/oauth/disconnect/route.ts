import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { and, eq, like, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthDisconnectAPI')

const disconnectSchema = z.object({
  provider: z.string({ required_error: 'Provider is required' }).min(1, 'Provider is required'),
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
      const firstError = parseResult.error.errors[0]
      const errorMessage = firstError?.message || 'Validation failed'

      logger.warn(`[${requestId}] Invalid disconnect request`, {
        errors: parseResult.error.errors,
      })

      return NextResponse.json(
        {
          error: errorMessage,
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

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error disconnecting OAuth provider`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
