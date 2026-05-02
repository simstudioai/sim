import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  confluenceBlogPostOperationContract,
  confluenceDeleteBlogPostContract,
  confluenceListBlogPostsContract,
  confluenceUpdateBlogPostContract,
} from '@/lib/api/contracts/selectors/confluence'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateJiraCloudId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getConfluenceCloudId } from '@/tools/confluence/utils'
import { parseAtlassianErrorMessage } from '@/tools/jira/utils'

const logger = createLogger('ConfluenceBlogPostsAPI')

export const dynamic = 'force-dynamic'

/**
 * List all blog posts or get a specific blog post
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(confluenceListBlogPostsContract, request, {})
    if (!parsed.success) return parsed.response

    const {
      domain,
      accessToken,
      cloudId: providedCloudId,
      limit,
      status,
      sort: sortOrder,
      cursor,
    } = parsed.data.query

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const queryParams = new URLSearchParams()
    queryParams.append('limit', String(Math.min(Number(limit), 250)))

    if (status) {
      queryParams.append('status', status)
    }

    if (sortOrder) {
      queryParams.append('sort', sortOrder)
    }

    if (cursor) {
      queryParams.append('cursor', cursor)
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/blogposts?${queryParams.toString()}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return NextResponse.json(
        { error: parseAtlassianErrorMessage(response.status, response.statusText, errorText) },
        { status: response.status }
      )
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
      webUrl: post._links?.webui ?? null,
    }))

    return NextResponse.json({
      blogPosts,
      nextCursor: data._links?.next
        ? new URL(data._links.next, 'https://placeholder').searchParams.get('cursor')
        : null,
    })
  } catch (error) {
    logger.error('Error listing blog posts:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})

/**
 * Get a specific blog post by ID
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(confluenceBlogPostOperationContract, request, {})
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    if ('title' in body && 'content' in body && 'spaceId' in body) {
      // Create blog post
      const {
        domain,
        accessToken,
        cloudId: providedCloudId,
        spaceId,
        title,
        content,
        status,
      } = body

      const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

      const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
      if (!cloudIdValidation.isValid) {
        return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
      }

      const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/blogposts`

      const createBody = {
        spaceId,
        status: status || 'current',
        title,
        body: {
          representation: 'storage',
          value: content,
        },
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(createBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Confluence API error response:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        })
        return NextResponse.json(
          { error: parseAtlassianErrorMessage(response.status, response.statusText, errorText) },
          { status: response.status }
        )
      }

      const data = await response.json()
      return NextResponse.json({
        id: data.id,
        title: data.title,
        spaceId: data.spaceId,
        webUrl: data._links?.webui ?? null,
      })
    }
    // Get blog post by ID
    const { domain, accessToken, cloudId: providedCloudId, blogPostId, bodyFormat } = body

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const queryParams = new URLSearchParams()
    if (bodyFormat) {
      queryParams.append('body-format', bodyFormat)
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/blogposts/${blogPostId}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return NextResponse.json(
        { error: parseAtlassianErrorMessage(response.status, response.statusText, errorText) },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json({
      id: data.id,
      title: data.title,
      status: data.status ?? null,
      spaceId: data.spaceId ?? null,
      authorId: data.authorId ?? null,
      createdAt: data.createdAt ?? null,
      version: data.version ?? null,
      body: data.body ?? null,
      webUrl: data._links?.webui ?? null,
    })
  } catch (error) {
    logger.error('Error with blog post operation:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})

/**
 * Update a blog post
 */
export const PUT = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(confluenceUpdateBlogPostContract, request, {})
    if (!parsed.success) return parsed.response

    const {
      domain,
      accessToken,
      blogPostId,
      title,
      content,
      cloudId: providedCloudId,
    } = parsed.data.body

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    // Fetch current blog post to get version number
    const currentUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/blogposts/${blogPostId}?body-format=storage`
    const currentResponse = await fetch(currentUrl, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!currentResponse.ok) {
      const errorText = await currentResponse.text()
      throw new Error(
        parseAtlassianErrorMessage(currentResponse.status, currentResponse.statusText, errorText)
      )
    }

    const currentPost = await currentResponse.json()

    if (!currentPost.version?.number) {
      return NextResponse.json(
        { error: 'Unable to determine current blog post version' },
        { status: 422 }
      )
    }

    const currentVersion = currentPost.version.number

    const updateBody: Record<string, unknown> = {
      id: blogPostId,
      version: { number: currentVersion + 1 },
      status: 'current',
      title: title || currentPost.title,
      body: {
        representation: 'storage',
        value: content || currentPost.body?.storage?.value || '',
      },
    }

    const response = await fetch(currentUrl, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(updateBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return NextResponse.json(
        { error: parseAtlassianErrorMessage(response.status, response.statusText, errorText) },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    logger.error('Error updating blog post:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})

/**
 * Delete a blog post
 */
export const DELETE = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(confluenceDeleteBlogPostContract, request, {})
    if (!parsed.success) return parsed.response

    const { domain, accessToken, blogPostId, cloudId: providedCloudId } = parsed.data.body

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/blogposts/${blogPostId}`

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return NextResponse.json(
        { error: parseAtlassianErrorMessage(response.status, response.statusText, errorText) },
        { status: response.status }
      )
    }

    return NextResponse.json({ blogPostId, deleted: true })
  } catch (error) {
    logger.error('Error deleting blog post:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})
