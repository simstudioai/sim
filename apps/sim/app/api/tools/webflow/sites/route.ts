import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebflowSitesAPI')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessToken = await getOAuthToken(session.user.id, 'webflow')

    if (!accessToken) {
      return NextResponse.json(
        { error: 'No Webflow access token found. Please connect your Webflow account.' },
        { status: 404 }
      )
    }

    const response = await fetch('https://api.webflow.com/v2/sites', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Webflow sites', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Webflow sites', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const sites = data.sites || []

    const formattedSites = sites.map((site: any) => ({
      id: site.id,
      name: site.displayName || site.shortName || site.id,
    }))

    return NextResponse.json({ sites: formattedSites }, { status: 200 })
  } catch (error: any) {
    logger.error('Error fetching Webflow sites', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
