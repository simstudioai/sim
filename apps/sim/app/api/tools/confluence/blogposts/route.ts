import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceBlogPostsAPI')

export const dynamic = 'force-dynamic'

const getBlogPostSchema = z
  .object({
    domain: z.string().min(1, 'Domain is required'),
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().optional(),
    blogPostId: z.string().min(1, 'Blog post ID is required'),
    bodyFormat: z.string().optional(),
  })
  .refine(
    (data) => {
      const validation = validateAlphanumericId(data.blogPostId, 'blogPostId', 255)
      return validation.isValid
    },
    (data) => {
      const validation = validateAlphanumericId(data.blogPostId, 'blogPostId', 255)
      return { message: validation.error || 'Invalid blog post ID', path: ['blogPostId'] }
    }
  )

const createBlogPostSchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: z.string().optional(),
  spaceId: z.string().min(1, 'Space ID is required'),
  title: z.string().min(1, 'Title is required'),
  content: z.string().min(1, 'Content is required'),
  status: z.enum(['current', 'draft']).optional(),
})

/**
 * List all blog posts or get a specific blog post
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const domain = searchParams.get('domain')
    const accessToken = searchParams.get('accessToken')
    const providedCloudId = searchParams.get('cloudId')
    const limit = searchParams.get('limit') || '25'
    const status = searchParams.get('status')
    const sortOrder = searchParams.get('sort')
    const cursor = searchParams.get('cursor')

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
      const errorData = await response.json().catch(() => null)
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2),
      })
      const errorMessage = errorData?.message || `Failed to list blog posts (${response.status})`
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
}

/**
 * Get a specific blog post by ID
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    // Check if this is a create or get request
    if (body.title && body.content && body.spaceId) {
      // Create blog post
      const validation = createBlogPostSchema.safeParse(body)
      if (!validation.success) {
        const firstError = validation.error.errors[0]
        return NextResponse.json({ error: firstError.message }, { status: 400 })
      }

      const {
        domain,
        accessToken,
        cloudId: providedCloudId,
        spaceId,
        title,
        content,
        status,
      } = validation.data

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
        const errorData = await response.json().catch(() => null)
        logger.error('Confluence API error response:', {
          status: response.status,
          statusText: response.statusText,
          error: JSON.stringify(errorData, null, 2),
        })
        const errorMessage = errorData?.message || `Failed to create blog post (${response.status})`
        return NextResponse.json({ error: errorMessage }, { status: response.status })
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
    const validation = getBlogPostSchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.errors[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const {
      domain,
      accessToken,
      cloudId: providedCloudId,
      blogPostId,
      bodyFormat,
    } = validation.data

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
      const errorData = await response.json().catch(() => null)
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2),
      })
      const errorMessage = errorData?.message || `Failed to get blog post (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
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
}
