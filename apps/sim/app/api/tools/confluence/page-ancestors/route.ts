import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluencePageAncestorsAPI')

export const dynamic = 'force-dynamic'

/**
 * Get ancestors (parent pages) of a specific Confluence page.
 * Uses GET /wiki/api/v2/pages/{id}/ancestors
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { domain, accessToken, pageId, cloudId: providedCloudId, limit = 25 } = body

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!pageId) {
      return NextResponse.json({ error: 'Page ID is required' }, { status: 400 })
    }

    const pageIdValidation = validateAlphanumericId(pageId, 'pageId', 255)
    if (!pageIdValidation.isValid) {
      return NextResponse.json({ error: pageIdValidation.error }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const queryParams = new URLSearchParams()
    queryParams.append('limit', String(Math.min(limit, 250)))

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/ancestors?${queryParams.toString()}`

    logger.info(`Fetching ancestors for page ${pageId}`)

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
      const errorMessage = errorData?.message || `Failed to get page ancestors (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    const ancestors = (data.results || []).map((page: any) => ({
      id: page.id,
      title: page.title,
      status: page.status ?? null,
      spaceId: page.spaceId ?? null,
      webUrl: page._links?.webui ?? null,
    }))

    return NextResponse.json({
      ancestors,
      pageId,
    })
  } catch (error) {
    logger.error('Error getting page ancestors:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
