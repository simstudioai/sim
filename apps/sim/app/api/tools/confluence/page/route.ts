import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluencePageAPI')

export const dynamic = 'force-dynamic'

const postPageSchema = z
  .object({
    domain: z.string().min(1, 'Domain is required'),
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().optional(),
    pageId: z.string().min(1, 'Page ID is required'),
  })
  .refine(
    (data) => {
      const validation = validateAlphanumericId(data.pageId, 'pageId', 255)
      return validation.isValid
    },
    (data) => {
      const validation = validateAlphanumericId(data.pageId, 'pageId', 255)
      return { message: validation.error || 'Invalid page ID', path: ['pageId'] }
    }
  )

const putPageSchema = z
  .object({
    domain: z.string().min(1, 'Domain is required'),
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().optional(),
    pageId: z.string().min(1, 'Page ID is required'),
    title: z.string().optional(),
    body: z
      .object({
        value: z.string().optional(),
      })
      .optional(),
    version: z
      .object({
        message: z.string().optional(),
      })
      .optional(),
  })
  .refine(
    (data) => {
      const validation = validateAlphanumericId(data.pageId, 'pageId', 255)
      return validation.isValid
    },
    (data) => {
      const validation = validateAlphanumericId(data.pageId, 'pageId', 255)
      return { message: validation.error || 'Invalid page ID', path: ['pageId'] }
    }
  )

const deletePageSchema = z
  .object({
    domain: z.string().min(1, 'Domain is required'),
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().optional(),
    pageId: z.string().min(1, 'Page ID is required'),
    purge: z.boolean().optional(),
  })
  .refine(
    (data) => {
      const validation = validateAlphanumericId(data.pageId, 'pageId', 255)
      return validation.isValid
    },
    (data) => {
      const validation = validateAlphanumericId(data.pageId, 'pageId', 255)
      return { message: validation.error || 'Invalid page ID', path: ['pageId'] }
    }
  )

export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    const validation = postPageSchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.errors[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const { domain, accessToken, cloudId: providedCloudId, pageId } = validation.data

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}?body-format=storage`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      logger.error(`Confluence API error: ${response.status} ${response.statusText}`)
      let errorMessage

      try {
        const errorData = await response.json()
        logger.error('Error details:', JSON.stringify(errorData, null, 2))
        errorMessage = errorData.message || `Failed to fetch Confluence page (${response.status})`
      } catch (e) {
        logger.error('Could not parse error response as JSON:', e)
        errorMessage = `Failed to fetch Confluence page: ${response.status} ${response.statusText}`
      }

      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    return NextResponse.json({
      id: data.id,
      title: data.title,
      body: {
        storage: {
          value: data.body?.storage?.value ?? null,
          representation: 'storage',
        },
      },
      status: data.status ?? null,
      spaceId: data.spaceId ?? null,
      parentId: data.parentId ?? null,
      authorId: data.authorId ?? null,
      createdAt: data.createdAt ?? null,
      version: data.version ?? null,
      _links: data._links ?? null,
    })
  } catch (error) {
    logger.error('Error fetching Confluence page:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    const validation = putPageSchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.errors[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const {
      domain,
      accessToken,
      pageId,
      cloudId: providedCloudId,
      title,
      body: pageBody,
      version,
    } = validation.data

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const currentPageUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}`
    const currentPageResponse = await fetch(currentPageUrl, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!currentPageResponse.ok) {
      throw new Error(`Failed to fetch current page: ${currentPageResponse.status}`)
    }

    const currentPage = await currentPageResponse.json()
    const currentVersion = currentPage.version.number

    const updateBody: any = {
      id: pageId,
      version: {
        number: currentVersion + 1,
        message: version?.message || 'Updated via API',
      },
      status: 'current',
    }

    if (title !== undefined && title !== null && title !== '') {
      updateBody.title = title
    } else {
      updateBody.title = currentPage.title
    }

    if (pageBody?.value !== undefined && pageBody?.value !== null && pageBody?.value !== '') {
      updateBody.body = {
        representation: 'storage',
        value: pageBody.value,
      }
    } else {
      updateBody.body = {
        representation: 'storage',
        value: currentPage.body?.storage?.value || '',
      }
    }

    const response = await fetch(currentPageUrl, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(updateBody),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2),
      })
      const errorMessage =
        errorData?.message ||
        (errorData?.errors && JSON.stringify(errorData.errors)) ||
        `Failed to update Confluence page (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    logger.error('Error updating Confluence page:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    const validation = deletePageSchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.errors[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const { domain, accessToken, cloudId: providedCloudId, pageId, purge } = validation.data

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const queryParams = new URLSearchParams()
    if (purge) {
      queryParams.append('purge', 'true')
    }
    const queryString = queryParams.toString()
    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}${queryString ? `?${queryString}` : ''}`

    const response = await fetch(url, {
      method: 'DELETE',
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
        errorData?.message || `Failed to delete Confluence page (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    return NextResponse.json({ pageId, deleted: true })
  } catch (error) {
    logger.error('Error deleting Confluence page:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
