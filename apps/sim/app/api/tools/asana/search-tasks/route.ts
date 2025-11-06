import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { validateAlphanumericId } from '@/lib/security/input-validation'

export const dynamic = 'force-dynamic'

const logger = createLogger('AsanaSearchTasksAPI')

export async function POST(request: Request) {
  try {
    const { accessToken, workspace, text, assignee, projects, completed } = await request.json()

    if (!accessToken) {
      logger.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!workspace) {
      logger.error('Missing workspace in request')
      return NextResponse.json({ error: 'Workspace is required' }, { status: 400 })
    }

    const workspaceValidation = validateAlphanumericId(workspace, 'workspace', 100)
    if (!workspaceValidation.isValid) {
      return NextResponse.json({ error: workspaceValidation.error }, { status: 400 })
    }

    const params = new URLSearchParams()

    if (text) {
      params.append('text', text)
    }

    if (assignee) {
      params.append('assignee.any', assignee)
    }

    if (projects && Array.isArray(projects) && projects.length > 0) {
      params.append('projects.any', projects.join(','))
    }

    if (completed !== undefined) {
      params.append('completed', String(completed))
    }

    params.append(
      'opt_fields',
      'gid,name,notes,completed,assignee,assignee.name,due_on,created_at,modified_at,created_by,created_by.name,resource_type,resource_subtype'
    )

    const url = `https://app.asana.com/api/1.0/workspaces/${workspace}/tasks/search?${params.toString()}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
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
    const tasks = result.data

    return NextResponse.json({
      success: true,
      output: {
        ts: new Date().toISOString(),
        tasks: tasks.map((task: any) => ({
          gid: task.gid,
          resource_type: task.resource_type,
          resource_subtype: task.resource_subtype,
          name: task.name,
          notes: task.notes || '',
          completed: task.completed || false,
          assignee: task.assignee
            ? {
                gid: task.assignee.gid,
                name: task.assignee.name,
              }
            : undefined,
          created_by: task.created_by
            ? {
                gid: task.created_by.gid,
                resource_type: task.created_by.resource_type,
                name: task.created_by.name,
              }
            : undefined,
          due_on: task.due_on || undefined,
          created_at: task.created_at,
          modified_at: task.modified_at,
        })),
        next_page: result.next_page,
      },
    })
  } catch (error) {
    logger.error('Error processing request:', error)
    return NextResponse.json(
      {
        error: 'Failed to search Asana tasks',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
