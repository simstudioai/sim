import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  validateAlphanumericId,
  validateJiraCloudId,
  validatePaginationCursor,
  validatePathSegment,
} from '@/lib/core/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceTasksAPI')

export const dynamic = 'force-dynamic'

/**
 * List, get, or update Confluence inline tasks.
 * Uses GET /wiki/api/v2/tasks, GET /wiki/api/v2/tasks/{id}, PUT /wiki/api/v2/tasks/{id}
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      domain,
      accessToken,
      cloudId: providedCloudId,
      action,
      taskId,
      status: taskStatus,
      pageId,
      spaceId,
      assignedTo,
      limit = 50,
      cursor,
    } = body

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

    // Update a task
    if (action === 'update' && taskId) {
      const taskIdValidation = validateAlphanumericId(taskId, 'taskId', 255)
      if (!taskIdValidation.isValid) {
        return NextResponse.json({ error: taskIdValidation.error }, { status: 400 })
      }

      // First fetch the current task to get required fields
      const getUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/tasks/${taskId}`
      const getResponse = await fetch(getUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!getResponse.ok) {
        const errorData = await getResponse.json().catch(() => null)
        const errorMessage = errorData?.message || `Failed to fetch task (${getResponse.status})`
        return NextResponse.json({ error: errorMessage }, { status: getResponse.status })
      }

      const currentTask = await getResponse.json()

      const updateBody: Record<string, unknown> = {
        id: taskId,
        status: taskStatus || currentTask.status,
      }

      const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/tasks/${taskId}`

      logger.info(`Updating task ${taskId}`)

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
        const errorMessage = errorData?.message || `Failed to update task (${response.status})`
        return NextResponse.json({ error: errorMessage }, { status: response.status })
      }

      const data = await response.json()
      return NextResponse.json({
        task: {
          id: data.id,
          localId: data.localId ?? null,
          spaceId: data.spaceId ?? null,
          pageId: data.pageId ?? null,
          blogPostId: data.blogPostId ?? null,
          status: data.status,
          body: data.body?.storage?.value ?? null,
          createdBy: data.createdBy ?? null,
          assignedTo: data.assignedTo ?? null,
          completedBy: data.completedBy ?? null,
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? null,
          dueAt: data.dueAt ?? null,
          completedAt: data.completedAt ?? null,
        },
      })
    }

    // Get a specific task
    if (taskId) {
      const taskIdValidation = validateAlphanumericId(taskId, 'taskId', 255)
      if (!taskIdValidation.isValid) {
        return NextResponse.json({ error: taskIdValidation.error }, { status: 400 })
      }

      const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/tasks/${taskId}`

      logger.info(`Fetching task ${taskId}`)

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
        const errorMessage = errorData?.message || `Failed to get task (${response.status})`
        return NextResponse.json({ error: errorMessage }, { status: response.status })
      }

      const data = await response.json()
      return NextResponse.json({
        task: {
          id: data.id,
          localId: data.localId ?? null,
          spaceId: data.spaceId ?? null,
          pageId: data.pageId ?? null,
          blogPostId: data.blogPostId ?? null,
          status: data.status,
          body: data.body?.storage?.value ?? null,
          createdBy: data.createdBy ?? null,
          assignedTo: data.assignedTo ?? null,
          completedBy: data.completedBy ?? null,
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? null,
          dueAt: data.dueAt ?? null,
          completedAt: data.completedAt ?? null,
        },
      })
    }

    // List tasks
    const queryParams = new URLSearchParams()
    queryParams.append('limit', String(Math.min(limit, 250)))

    if (cursor) {
      const cursorValidation = validatePaginationCursor(cursor, 'cursor')
      if (!cursorValidation.isValid) {
        return NextResponse.json({ error: cursorValidation.error }, { status: 400 })
      }
      queryParams.append('cursor', cursor)
    }
    if (taskStatus) queryParams.append('status', taskStatus)
    if (pageId) {
      const pageIdValidation = validateAlphanumericId(pageId, 'pageId', 255)
      if (!pageIdValidation.isValid) {
        return NextResponse.json({ error: pageIdValidation.error }, { status: 400 })
      }
      queryParams.append('page-id', pageId)
    }
    if (spaceId) {
      const spaceIdValidation = validateAlphanumericId(spaceId, 'spaceId', 255)
      if (!spaceIdValidation.isValid) {
        return NextResponse.json({ error: spaceIdValidation.error }, { status: 400 })
      }
      queryParams.append('space-id', spaceId)
    }
    if (assignedTo) {
      // Atlassian account IDs: 5d5bd05c3aee0123abc or 557058:6b9c9931-4693-49c1-8b3a-931f1af98134
      const assignedToValidation = validatePathSegment(assignedTo, {
        paramName: 'assignedTo',
        maxLength: 128,
        customPattern: /^[a-zA-Z0-9_|:-]+$/,
      })
      if (!assignedToValidation.isValid) {
        return NextResponse.json({ error: assignedToValidation.error }, { status: 400 })
      }
      queryParams.append('assigned-to', assignedTo)
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/tasks?${queryParams.toString()}`

    logger.info('Fetching tasks')

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
      const errorMessage = errorData?.message || `Failed to list tasks (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    const tasks = (data.results || []).map((task: any) => ({
      id: task.id,
      localId: task.localId ?? null,
      spaceId: task.spaceId ?? null,
      pageId: task.pageId ?? null,
      blogPostId: task.blogPostId ?? null,
      status: task.status,
      body: task.body?.storage?.value ?? null,
      createdBy: task.createdBy ?? null,
      assignedTo: task.assignedTo ?? null,
      completedBy: task.completedBy ?? null,
      createdAt: task.createdAt ?? null,
      updatedAt: task.updatedAt ?? null,
      dueAt: task.dueAt ?? null,
      completedAt: task.completedAt ?? null,
    }))

    return NextResponse.json({
      tasks,
      nextCursor: data._links?.next
        ? new URL(data._links.next, 'https://placeholder').searchParams.get('cursor')
        : null,
    })
  } catch (error) {
    logger.error('Error with tasks:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
