import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluencePageVersionsAPI')

export const dynamic = 'force-dynamic'

/**
 * List all versions of a page or get a specific version.
 * Uses GET /wiki/api/v2/pages/{id}/versions
 * and GET /wiki/api/v2/pages/{page-id}/versions/{version-number}
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
      pageId,
      versionNumber,
      cloudId: providedCloudId,
      limit = 50,
      cursor,
    } = body

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

    // If versionNumber is provided, get specific version
    if (versionNumber !== undefined && versionNumber !== null) {
      const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/versions/${versionNumber}`

      logger.info(`Fetching version ${versionNumber} for page ${pageId}`)

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
        const errorMessage = errorData?.message || `Failed to get page version (${response.status})`
        return NextResponse.json({ error: errorMessage }, { status: response.status })
      }

      const data = await response.json()

      return NextResponse.json({
        version: {
          number: data.number,
          message: data.message ?? null,
          minorEdit: data.minorEdit ?? false,
          authorId: data.authorId ?? null,
          createdAt: data.createdAt ?? null,
        },
        pageId,
      })
    }
    // List all versions
    const queryParams = new URLSearchParams()
    queryParams.append('limit', String(Math.min(limit, 250)))

    if (cursor) {
      queryParams.append('cursor', cursor)
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/versions?${queryParams.toString()}`

    logger.info(`Fetching versions for page ${pageId}`)

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
      const errorMessage = errorData?.message || `Failed to list page versions (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    const versions = (data.results || []).map((version: any) => ({
      number: version.number,
      message: version.message ?? null,
      minorEdit: version.minorEdit ?? false,
      authorId: version.authorId ?? null,
      createdAt: version.createdAt ?? null,
    }))

    return NextResponse.json({
      versions,
      pageId,
      nextCursor: data._links?.next
        ? new URL(data._links.next, 'https://placeholder').searchParams.get('cursor')
        : null,
    })
  } catch (error) {
    logger.error('Error with page versions:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
