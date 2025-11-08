import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

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
export async function PUT(request: Request) {
  try {
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
      throw new Error(`Failed to fetch current comment: ${getResponse.status}`)
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
      const errorData = await response.json().catch(() => null)
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2),
      })
      const errorMessage =
        errorData?.message || `Failed to update Confluence comment (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
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
}

// Delete a comment
export async function DELETE(request: Request) {
  try {
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
      const errorData = await response.json().catch(() => null)
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2),
      })
      const errorMessage =
        errorData?.message || `Failed to delete Confluence comment (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    return NextResponse.json({ commentId, deleted: true })
  } catch (error) {
    logger.error('Error deleting Confluence comment:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
