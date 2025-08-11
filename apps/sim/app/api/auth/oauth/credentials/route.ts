import { and, eq } from 'drizzle-orm'
import { jwtDecode } from 'jwt-decode'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import type { OAuthService } from '@/lib/oauth/oauth'
import { parseProvider } from '@/lib/oauth/oauth'
import { db } from '@/db'
import { account, user, workflow } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthCredentialsAPI')

interface GoogleIdToken {
  email?: string
  sub?: string
  name?: string
}

/**
 * Get credentials for a specific provider
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Get query params
    const { searchParams } = new URL(request.url)
    const providerParam = searchParams.get('provider') as OAuthService | null
    const workflowId = searchParams.get('workflowId')
    const credentialId = searchParams.get('credentialId')

    // Resolve effective user id: workflow owner if workflowId provided; else session user
    let effectiveUserId: string | undefined
    if (workflowId) {
      const rows = await db
        .select({ userId: workflow.userId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)
      effectiveUserId = rows[0]?.userId
    }

    if (!effectiveUserId) {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthenticated credentials request rejected`)
        return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
      }
      effectiveUserId = session.user.id
    }

    if (!providerParam && !credentialId) {
      logger.warn(`[${requestId}] Missing provider parameter`)
      return NextResponse.json({ error: 'Provider or credentialId is required' }, { status: 400 })
    }

    // Parse the provider to get base provider and feature type (if provider is present)
    const { baseProvider } = parseProvider(providerParam || 'google-default')

    let accountsData

    if (credentialId) {
      // Fetch a single credential by id for the effective user
      accountsData = await db
        .select()
        .from(account)
        .where(and(eq(account.userId, effectiveUserId), eq(account.id, credentialId)))
    } else {
      // Fetch all credentials for provider and effective user
      accountsData = await db
        .select()
        .from(account)
        .where(and(eq(account.userId, effectiveUserId), eq(account.providerId, providerParam!)))
    }

    // Transform accounts into credentials
    const credentials = await Promise.all(
      accountsData.map(async (acc) => {
        // Extract the feature type from providerId (e.g., 'google-default' -> 'default')
        const [_, featureType = 'default'] = acc.providerId.split('-')

        // Try multiple methods to get a user-friendly display name
        let displayName = ''

        // Method 1: Try to extract email from ID token (works for Google, etc.)
        if (acc.idToken) {
          try {
            const decoded = jwtDecode<GoogleIdToken>(acc.idToken)
            if (decoded.email) {
              displayName = decoded.email
            } else if (decoded.name) {
              displayName = decoded.name
            }
          } catch (_error) {
            logger.warn(`[${requestId}] Error decoding ID token`, {
              accountId: acc.id,
            })
          }
        }

        // Method 2: For GitHub, the accountId might be the username
        if (!displayName && baseProvider === 'github') {
          displayName = `${acc.accountId} (GitHub)`
        }

        // Method 3: Try to get the user's email from our database
        if (!displayName) {
          try {
            const userRecord = await db
              .select({ email: user.email })
              .from(user)
              .where(eq(user.id, acc.userId))
              .limit(1)

            if (userRecord.length > 0) {
              displayName = userRecord[0].email
            }
          } catch (_error) {
            logger.warn(`[${requestId}] Error fetching user email`, {
              userId: acc.userId,
            })
          }
        }

        // Fallback: Use accountId with provider type as context
        if (!displayName) {
          displayName = `${acc.accountId} (${baseProvider})`
        }

        return {
          id: acc.id,
          name: displayName,
          provider: acc.providerId,
          lastUsed: acc.updatedAt.toISOString(),
          isDefault: featureType === 'default',
        }
      })
    )

    return NextResponse.json({ credentials }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching OAuth credentials`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
