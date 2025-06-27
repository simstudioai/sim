import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { getSession } from '@/lib/auth'
import { setCredentialAsDefault, setDefaultCredentialForProvider } from '@/lib/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthSetDefaultAPI')

/**
 * Set a credential as default for a provider
 * POST /api/auth/oauth/set-default
 * Body: { providerId: string, credentialId?: string }
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Parse request body
    const body = await request.json()
    const { providerId, credentialId } = body

    if (!providerId) {
      logger.warn(`[${requestId}] Missing providerId parameter`)
      return NextResponse.json({ error: 'Provider ID is required' }, { status: 400 })
    }

    if (credentialId) {
      // Set a specific credential as default
      await setCredentialAsDefault(session.user.id, providerId, credentialId)
      logger.info(`[${requestId}] Set specific credential as default`, {
        userId: session.user.id,
        providerId,
        credentialId,
      })
    } else {
      // Set the first credential for this provider as default
      await setDefaultCredentialForProvider(session.user.id, providerId)
      logger.info(`[${requestId}] Set first credential as default`, {
        userId: session.user.id,
        providerId,
      })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error setting default credential`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 