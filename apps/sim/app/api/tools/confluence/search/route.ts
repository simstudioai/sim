import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { validateJiraCloudId } from '@/lib/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('Confluence Search')

export async function POST(request: Request) {
  try {
    const {
      domain,
      accessToken,
      cloudId: providedCloudId,
      query,
      limit = 25,
    } = await request.json()

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!query) {
      return NextResponse.json({ error: 'Search query is required' }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const searchParams = new URLSearchParams({
      cql: `text ~ "${query}"`,
      limit: limit.toString(),
    })

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/search?${searchParams.toString()}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2),
      })
      const errorMessage = errorData?.message || `Failed to search Confluence (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    const results = (data.results || []).map((result: any) => ({
      id: result.content?.id || result.id,
      title: result.content?.title || result.title,
      type: result.content?.type || result.type,
      url: result.url || result._links?.webui || '',
      excerpt: result.excerpt || '',
    }))

    return NextResponse.json({ results })
  } catch (error) {
    logger.error('Error searching Confluence:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
