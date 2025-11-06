import { NextResponse } from 'next/server'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

export const dynamic = 'force-dynamic'

// Update a comment
export async function PUT(request: Request) {
  try {
    const {
      domain,
      accessToken,
      cloudId: providedCloudId,
      commentId,
      comment,
    } = await request.json()

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!commentId) {
      return NextResponse.json({ error: 'Comment ID is required' }, { status: 400 })
    }

    if (!comment) {
      return NextResponse.json({ error: 'Comment is required' }, { status: 400 })
    }

    const commentIdValidation = validateAlphanumericId(commentId, 'commentId', 255)
    if (!commentIdValidation.isValid) {
      return NextResponse.json({ error: commentIdValidation.error }, { status: 400 })
    }

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

    const body = {
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
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      console.error('Confluence API error response:', {
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
    console.error('Error updating Confluence comment:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// Delete a comment
export async function DELETE(request: Request) {
  try {
    const { domain, accessToken, cloudId: providedCloudId, commentId } = await request.json()

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!commentId) {
      return NextResponse.json({ error: 'Comment ID is required' }, { status: 400 })
    }

    const commentIdValidation = validateAlphanumericId(commentId, 'commentId', 255)
    if (!commentIdValidation.isValid) {
      return NextResponse.json({ error: commentIdValidation.error }, { status: 400 })
    }

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
      console.error('Confluence API error response:', {
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
    console.error('Error deleting Confluence comment:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
