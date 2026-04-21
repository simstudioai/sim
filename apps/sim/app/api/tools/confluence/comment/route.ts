import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getConfluenceCloudId } from '@/tools/confluence/utils'
import { parseAtlassianErrorMessage } from '@/tools/jira/utils'

const logger = createLogger('ConfluenceCommentAPI')

export const dynamic = 'force-dynamic'

const putCommentSchema = z
  .object({
    domain: z.string().min(1, 'Domain is required'),
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().optional(),
    commentId: z.string().min(1, 'Comment ID is required'),
    comment: z.string().min(1, 'Comment is required'),
  })
  .refine(
    (data) => {
      const validation = validateAlphanumericId(data.commentId, 'commentId', 255)
      return validation.isValid
    },
    (data) => {
      const validation = validateAlphanumericId(data.commentId, 'commentId', 255)
      return { message: validation.error || 'Invalid comment ID', path: ['commentId'] }
    }
  )

const deleteCommentSchema = z
  .object({
    domain: z.string().min(1, 'Domain is required'),
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().optional(),
    commentId: z.string().min(1, 'Comment ID is required'),
  })
  .refine(
    (data) => {
      const validation = validateAlphanumericId(data.commentId, 'commentId', 255)
      return validation.isValid
    },
    (data) => {
      const validation = validateAlphanumericId(data.commentId, 'commentId', 255)
      return { message: validation.error || 'Invalid comment ID', path: ['commentId'] }
    }
  )

// Update a comment
export const PUT = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    const validation = putCommentSchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.errors[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const { domain, accessToken, cloudId: providedCloudId, commentId, comment } = validation.data

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    // Get current comment version
    const getUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/footer-comments/${commentId}`
    const getResponse = await fetch(getUrl, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!getResponse.ok) {
      const errorText = await getResponse.text()
      throw new Error(
        parseAtlassianErrorMessage(getResponse.status, getResponse.statusText, errorText)
      )
    }

    const currentComment = await getResponse.json()
    const currentVersion = currentComment.version?.number || 1

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/footer-comments/${commentId}`

    const updateBody = {
      body: {
        representation: 'storage',
        value: comment,
      },
      version: {
        number: currentVersion + 1,
        message: 'Updated via Sim',
      },
    }

    const response = await fetch(url, {
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
    logger.error('Error updating Confluence comment:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})

// Delete a comment
export const DELETE = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    const validation = deleteCommentSchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.errors[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const { domain, accessToken, cloudId: providedCloudId, commentId } = validation.data

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/footer-comments/${commentId}`

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

    return NextResponse.json({ commentId, deleted: true })
  } catch (error) {
    logger.error('Error deleting Confluence comment:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})
