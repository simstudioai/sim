import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'

const logger = createLogger('TrelloAuthorize')

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const apiKey = env.TRELLO_API_KEY

    if (!apiKey) {
      logger.error('TRELLO_API_KEY not configured')
      return NextResponse.json({ error: 'Trello API key not configured' }, { status: 500 })
    }

    const baseUrl = getBaseUrl()
    const returnUrl = `${baseUrl}/api/auth/trello/callback`
    const scope = getCanonicalScopesForProvider('trello').join(',')

    const authUrl = new URL('https://trello.com/1/authorize')
    authUrl.searchParams.set('key', apiKey)
    authUrl.searchParams.set('name', 'Sim Studio')
    authUrl.searchParams.set('expiration', 'never')
    authUrl.searchParams.set('callback_method', 'fragment')
    authUrl.searchParams.set('response_type', 'token')
    authUrl.searchParams.set('scope', scope)
    authUrl.searchParams.set('return_url', returnUrl)

    return NextResponse.redirect(authUrl.toString())
  } catch (error) {
    logger.error('Error initiating Trello authorization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
