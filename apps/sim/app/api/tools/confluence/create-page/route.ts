import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceCreatePageAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const {
      domain,
      accessToken,
      cloudId: providedCloudId,
      spaceId,
      title,
      content,
      parentId,
    } = await request.json()

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!spaceId) {
      return NextResponse.json({ error: 'Space ID is required' }, { status: 400 })
    }

    if (!/^\d+$/.test(String(spaceId))) {
      return NextResponse.json(
        {
          error:
            'Invalid Space ID. The Space ID must be a numeric value, not the space key from the URL. Use the "list" operation to get all spaces with their numeric IDs.',
        },
        { status: 400 }
      )
    }

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    if (!content) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    const spaceIdValidation = validateAlphanumericId(spaceId, 'spaceId', 255)
    if (!spaceIdValidation.isValid) {
      return NextResponse.json({ error: spaceIdValidation.error }, { status: 400 })
    }

    if (parentId) {
      const parentIdValidation = validateAlphanumericId(parentId, 'parentId', 255)
      if (!parentIdValidation.isValid) {
        return NextResponse.json({ error: parentIdValidation.error }, { status: 400 })
      }
    }

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const createBody: any = {
      spaceId,
      status: 'current',
      title,
      body: {
        representation: 'storage',
        value: content,
      },
    }

    if (parentId !== undefined && parentId !== null && parentId !== '') {
      createBody.parentId = parentId
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages`

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

      let errorMessage = `Failed to create Confluence page (${response.status})`
      if (errorData?.message) {
        errorMessage = errorData.message
      } else if (errorData?.errors && Array.isArray(errorData.errors)) {
        const firstError = errorData.errors[0]
        if (firstError?.title) {
          if (firstError.title.includes("'spaceId'") && firstError.title.includes('Long')) {
            errorMessage =
              'Invalid Space ID. Use the list spaces operation to find valid space IDs.'
          } else {
            errorMessage = firstError.title
          }
        } else {
          errorMessage = JSON.stringify(errorData.errors)
        }
      }

      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    logger.error('Error creating Confluence page:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
