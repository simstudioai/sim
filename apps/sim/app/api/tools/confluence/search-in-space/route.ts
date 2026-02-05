import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceSearchInSpaceAPI')

export const dynamic = 'force-dynamic'

/**
 * Search for content within a specific Confluence space using CQL.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      domain,
      accessToken,
      spaceKey,
      query,
      cloudId: providedCloudId,
      limit = 25,
      contentType,
    } = body

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!spaceKey) {
      return NextResponse.json({ error: 'Space key is required' }, { status: 400 })
    }

    const spaceKeyValidation = validateAlphanumericId(spaceKey, 'spaceKey', 255)
    if (!spaceKeyValidation.isValid) {
      return NextResponse.json({ error: spaceKeyValidation.error }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const escapeCqlValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

    let cql = `space = "${escapeCqlValue(spaceKey)}"`

    if (query) {
      cql += ` AND text ~ "${escapeCqlValue(query)}"`
    }

    if (contentType) {
      cql += ` AND type = "${escapeCqlValue(contentType)}"`
    }

    const searchParams = new URLSearchParams({
      cql,
      limit: String(Math.min(limit, 250)),
    })

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/search?${searchParams.toString()}`

    logger.info(`Searching in space ${spaceKey} with CQL: ${cql}`)

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
      const errorMessage = errorData?.message || `Failed to search in space (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    const results = (data.results || []).map((result: any) => ({
      id: result.content?.id ?? result.id,
      title: result.content?.title ?? result.title,
      type: result.content?.type ?? result.type,
      status: result.content?.status ?? null,
      url: result.url ?? result._links?.webui ?? '',
      excerpt: result.excerpt ?? '',
      lastModified: result.lastModified ?? null,
    }))

    return NextResponse.json({
      results,
      spaceKey,
      totalSize: data.totalSize ?? results.length,
    })
  } catch (error) {
    logger.error('Error searching in space:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
