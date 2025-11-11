import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { validateAlphanumericId } from '@/lib/security/input-validation'

export const dynamic = 'force-dynamic'

const logger = createLogger('AsanaUpdateTaskAPI')

export async function PUT(request: Request) {
  try {
    const { accessToken, taskGid, name, notes, assignee, completed, due_on } = await request.json()

    if (!accessToken) {
      logger.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!taskGid) {
      logger.error('Missing task GID in request')
      return NextResponse.json({ error: 'Task GID is required' }, { status: 400 })
    }

    const taskGidValidation = validateAlphanumericId(taskGid, 'taskGid', 100)
    if (!taskGidValidation.isValid) {
      return NextResponse.json({ error: taskGidValidation.error }, { status: 400 })
    }

    const url = `https://app.asana.com/api/1.0/tasks/${taskGid}`

    const taskData: Record<string, any> = {}

    if (name !== undefined) {
      taskData.name = name
    }

    if (notes !== undefined) {
      taskData.notes = notes
    }

    if (assignee !== undefined) {
      taskData.assignee = assignee
    }

    if (completed !== undefined) {
      taskData.completed = completed
    }

    if (due_on !== undefined) {
      taskData.due_on = due_on
    }

    const body = { data: taskData }

    const response = await fetch(url, {
      method: 'PUT',
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
    const task = result.data

    return NextResponse.json({
      success: true,
      output: {
        ts: new Date().toISOString(),
        gid: task.gid,
        name: task.name,
        notes: task.notes || '',
        completed: task.completed || false,
        modified_at: task.modified_at,
      },
    })
  } catch (error: any) {
    logger.error('Error updating Asana task:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
        success: false,
      },
      { status: 500 }
    )
  }
}
