import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  validateAlphanumericId,
  validateJiraCloudId,
  validateNumericId,
  validatePaginationCursor,
} from '@/lib/core/security/input-validation'
import { cleanHtmlContent, getConfluenceCloudId } from '@/tools/confluence/utils'

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

    // If versionNumber is provided, get specific version with page content
    if (versionNumber !== undefined && versionNumber !== null) {
      const versionValidation = validateNumericId(versionNumber, 'versionNumber', { min: 1 })
      if (!versionValidation.isValid) {
        return NextResponse.json({ error: versionValidation.error }, { status: 400 })
      }
      const safeVersion = versionValidation.sanitized

      const versionUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/versions/${safeVersion}`
      const pageUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}?version=${safeVersion}&body-format=storage`

      logger.info(`Fetching version ${versionNumber} for page ${pageId}`)

      const [versionResponse, pageResponse] = await Promise.all([
        fetch(versionUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        }),
        fetch(pageUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      ])

      if (!versionResponse.ok) {
        const errorData = await versionResponse.json().catch(() => null)
        logger.error('Confluence API error response:', {
          status: versionResponse.status,
          statusText: versionResponse.statusText,
          error: JSON.stringify(errorData, null, 2),
        })
        const errorMessage =
          errorData?.message || `Failed to get page version (${versionResponse.status})`
        return NextResponse.json({ error: errorMessage }, { status: versionResponse.status })
      }

      const versionData = await versionResponse.json()

      let title: string | null = null
      let content: string | null = null
      let body: Record<string, unknown> | null = null

      if (pageResponse.ok) {
        const pageData = await pageResponse.json()
        title = pageData.title ?? null
        body = pageData.body ?? null

        const rawContent =
          pageData.body?.storage?.value ||
          pageData.body?.view?.value ||
          pageData.body?.atlas_doc_format?.value ||
          ''
        if (rawContent) {
          content = cleanHtmlContent(rawContent)
        }
      } else {
        logger.warn(
          `Could not fetch page content for version ${versionNumber}: ${pageResponse.status}`
        )
      }

      return NextResponse.json({
        version: {
          number: versionData.number,
          message: versionData.message ?? null,
          minorEdit: versionData.minorEdit ?? false,
          authorId: versionData.authorId ?? null,
          createdAt: versionData.createdAt ?? null,
        },
        pageId,
        title,
        content,
        body,
      })
    }
    // List all versions
    const queryParams = new URLSearchParams()
    queryParams.append('limit', String(Math.min(limit, 250)))

    if (cursor) {
      const cursorValidation = validatePaginationCursor(cursor, 'cursor')
      if (!cursorValidation.isValid) {
        return NextResponse.json({ error: cursorValidation.error }, { status: 400 })
      }
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
