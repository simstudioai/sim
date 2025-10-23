import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebflowCollectionsAPI')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const siteId = searchParams.get('siteId')

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId parameter' }, { status: 400 })
    }

    const accessToken = await getOAuthToken(session.user.id, 'webflow')

    if (!accessToken) {
      return NextResponse.json(
        { error: 'No Webflow access token found. Please connect your Webflow account.' },
        { status: 404 }
      )
    }

    const response = await fetch(`https://api.webflow.com/v2/sites/${siteId}/collections`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Webflow collections', {
        status: response.status,
        error: errorData,
        siteId,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Webflow collections', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const collections = data.collections || []

    const formattedCollections = collections.map((collection: any) => ({
      id: collection.id,
      name: collection.displayName || collection.slug || collection.id,
    }))

    return NextResponse.json({ collections: formattedCollections }, { status: 200 })
  } catch (error: any) {
    logger.error('Error fetching Webflow collections', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
