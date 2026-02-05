import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceSpaceBlogPostsAPI')

export const dynamic = 'force-dynamic'

/**
 * List all blog posts in a specific Confluence space.
 * Uses GET /wiki/api/v2/spaces/{id}/blogposts
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
      spaceId,
      cloudId: providedCloudId,
      limit = 25,
      status,
      bodyFormat,
      cursor,
    } = body

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!spaceId) {
      return NextResponse.json({ error: 'Space ID is required' }, { status: 400 })
    }

    const spaceIdValidation = validateAlphanumericId(spaceId, 'spaceId', 255)
    if (!spaceIdValidation.isValid) {
      return NextResponse.json({ error: spaceIdValidation.error }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const queryParams = new URLSearchParams()
    queryParams.append('limit', String(Math.min(limit, 250)))

    if (status) {
      queryParams.append('status', status)
    }

    if (bodyFormat) {
      queryParams.append('body-format', bodyFormat)
    }

    if (cursor) {
      queryParams.append('cursor', cursor)
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/spaces/${spaceId}/blogposts?${queryParams.toString()}`

    logger.info(`Fetching blog posts in space ${spaceId}`)

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
      const errorMessage =
        errorData?.message || `Failed to list blog posts in space (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    const blogPosts = (data.results || []).map((post: any) => ({
      id: post.id,
      title: post.title,
      status: post.status ?? null,
      spaceId: post.spaceId ?? null,
      authorId: post.authorId ?? null,
      createdAt: post.createdAt ?? null,
      version: post.version ?? null,
      body: post.body ?? null,
      webUrl: post._links?.webui ?? null,
    }))

    return NextResponse.json({
      blogPosts,
      nextCursor: data._links?.next
        ? new URL(data._links.next, 'https://placeholder').searchParams.get('cursor')
        : null,
    })
  } catch (error) {
    logger.error('Error listing blog posts in space:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
