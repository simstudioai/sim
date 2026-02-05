import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('Confluence Search')

export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

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

    const escapeCqlValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

    const searchParams = new URLSearchParams({
      cql: `text ~ "${escapeCqlValue(query)}"`,
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

    const results = (data.results || []).map((result: any) => {
      const spaceData = result.resultGlobalContainer || result.content?.space
      return {
        id: result.content?.id || result.id,
        title: result.content?.title || result.title,
        type: result.content?.type || result.type,
        url: result.url || result._links?.webui || '',
        excerpt: result.excerpt || '',
        status: result.content?.status ?? null,
        spaceKey: result.resultGlobalContainer?.key ?? result.content?.space?.key ?? null,
        space: spaceData
          ? {
              id: spaceData.id ?? null,
              key: spaceData.key ?? null,
              name: spaceData.name ?? spaceData.title ?? null,
            }
          : null,
        lastModified: result.lastModified ?? result.content?.history?.lastUpdated?.when ?? null,
        entityType: result.entityType ?? null,
      }
    })

    return NextResponse.json({ results })
  } catch (error) {
    logger.error('Error searching Confluence:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
