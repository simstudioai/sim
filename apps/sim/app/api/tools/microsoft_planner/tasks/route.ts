import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftPlannerTasksSelectorContract } from '@/lib/api/contracts/selectors/microsoft'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateMicrosoftGraphId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import type { PlannerTask } from '@/tools/microsoft_planner/types'
import { assertGraphNextPageUrl, getGraphNextPageUrl } from '@/tools/sharepoint/utils'

const logger = createLogger('MicrosoftPlannerTasksAPI')

export const dynamic = 'force-dynamic'

/**
 * Upper bound on Microsoft Graph pages drained when listing a plan's tasks.
 * Planner uses server-side paging (`$top` is generally ignored), so this caps
 * the `@odata.nextLink` follow loop to prevent an unbounded drain.
 */
const MAX_TASKS_PAGES = 20

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsed = await parseRequest(microsoftPlannerTasksSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId, planId } = parsed.data.body

    const planIdValidation = validateMicrosoftGraphId(planId, 'planId')
    if (!planIdValidation.isValid) {
      logger.error(`[${requestId}] Invalid planId: ${planIdValidation.error}`)
      return NextResponse.json({ error: planIdValidation.error }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId: credential,
      workflowId,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credential,
      authz.credentialOwnerUserId,
      requestId
    )
    if (!accessToken) {
      logger.error(`[${requestId}] Failed to obtain valid access token`)
      return NextResponse.json(
        { error: 'Failed to obtain valid access token', authRequired: true },
        { status: 401 }
      )
    }

    let nextUrl: string | undefined =
      `https://graph.microsoft.com/v1.0/planner/plans/${planIdValidation.sanitized}/tasks`

    const rawTasks: PlannerTask[] = []
    for (let page = 0; page < MAX_TASKS_PAGES && nextUrl; page++) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`[${requestId}] Microsoft Graph API error:`, errorText)
        return NextResponse.json(
          { error: 'Failed to fetch tasks from Microsoft Graph' },
          { status: response.status }
        )
      }

      const data = await response.json()
      if (Array.isArray(data.value)) {
        rawTasks.push(...data.value)
      }

      const nextLink = getGraphNextPageUrl(data)
      nextUrl = nextLink ? assertGraphNextPageUrl(nextLink) : undefined
      if (nextUrl && page === MAX_TASKS_PAGES - 1) {
        logger.warn(
          `[${requestId}] Planner tasks pagination hit ${MAX_TASKS_PAGES}-page cap; result may be incomplete`
        )
      }
    }

    const filteredTasks = rawTasks.map((task: PlannerTask) => ({
      id: task.id,
      title: task.title,
      planId: task.planId,
      bucketId: task.bucketId,
      percentComplete: task.percentComplete,
      priority: task.priority,
      dueDateTime: task.dueDateTime,
      createdDateTime: task.createdDateTime,
      completedDateTime: task.completedDateTime,
      hasDescription: task.hasDescription,
      assignments: task.assignments ? Object.keys(task.assignments) : [],
    }))

    return NextResponse.json({
      tasks: filteredTasks,
      metadata: {
        planId,
        planUrl: `https://graph.microsoft.com/v1.0/planner/plans/${planId}`,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Microsoft Planner tasks:`, error)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
})
