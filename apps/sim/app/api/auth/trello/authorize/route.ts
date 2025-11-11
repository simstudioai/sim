import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('TrelloAuthorize')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
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

    const authUrl = new URL('https://trello.com/1/authorize')
    authUrl.searchParams.set('key', apiKey)
    authUrl.searchParams.set('name', 'Sim Studio')
    authUrl.searchParams.set('expiration', 'never')
    authUrl.searchParams.set('response_type', 'token')
    authUrl.searchParams.set('scope', 'read,write')
    authUrl.searchParams.set('return_url', returnUrl)

    return NextResponse.redirect(authUrl.toString())
  } catch (error) {
    logger.error('Error initiating Trello authorization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
