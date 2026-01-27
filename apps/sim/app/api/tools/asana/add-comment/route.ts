import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'

export const dynamic = 'force-dynamic'

const logger = createLogger('AsanaAddCommentAPI')

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const { accessToken, taskGid, text } = await request.json()

    if (!accessToken) {
      logger.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!taskGid) {
      logger.error('Missing task GID in request')
      return NextResponse.json({ error: 'Task GID is required' }, { status: 400 })
    }

    if (!text) {
      logger.error('Missing comment text in request')
      return NextResponse.json({ error: 'Comment text is required' }, { status: 400 })
    }

    const taskGidValidation = validateAlphanumericId(taskGid, 'taskGid', 100)
    if (!taskGidValidation.isValid) {
      return NextResponse.json({ error: taskGidValidation.error }, { status: 400 })
    }

    const url = `https://app.asana.com/api/1.0/tasks/${taskGid}/stories`

    const body = {
      data: {
        text,
      },
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `Asana API error: ${response.status} ${response.statusText}`

      try {
        const errorData = JSON.parse(errorText)
        const asanaError = errorData.errors?.[0]
        if (asanaError) {
          errorMessage = `${asanaError.message || errorMessage} (${asanaError.help || ''})`
        }
        logger.error('Asana API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData,
        })
      } catch (_e) {
        logger.error('Asana API error (unparsed):', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        })
      }

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          details: errorText,
        },
        { status: response.status }
      )
    }

    const result = await response.json()
    const story = result.data

    return NextResponse.json({
      success: true,
      ts: new Date().toISOString(),
      gid: story.gid,
      text: story.text || '',
      created_at: story.created_at,
      created_by: story.created_by
        ? {
            gid: story.created_by.gid,
            name: story.created_by.name,
          }
        : undefined,
    })
  } catch (error) {
    logger.error('Error processing request:', error)
    return NextResponse.json(
      {
        error: 'Failed to add comment to Asana task',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
