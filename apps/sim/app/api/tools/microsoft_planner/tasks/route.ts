import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateMicrosoftGraphId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import type { PlannerTask } from '@/tools/microsoft_planner/types'

const logger = createLogger('MicrosoftPlannerTasksAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: Request) => {
  const requestId = generateRequestId()

  try {
    const body = await request.json()
    const { credential, workflowId, planId } = body

    if (!credential) {
      logger.error(`[${requestId}] Missing credential in request`)
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    if (!planId) {
      logger.error(`[${requestId}] Missing planId in request`)
      return NextResponse.json({ error: 'Plan ID is required' }, { status: 400 })
    }

    const planIdValidation = validateMicrosoftGraphId(planId, 'planId')
    if (!planIdValidation.isValid) {
      logger.error(`[${requestId}] Invalid planId: ${planIdValidation.error}`)
      return NextResponse.json({ error: planIdValidation.error }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request as any, {
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

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/planner/plans/${planIdValidation.sanitized}/tasks`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Microsoft Graph API error:`, errorText)
      return NextResponse.json(
        { error: 'Failed to fetch tasks from Microsoft Graph' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const tasks = data.value || []

    const filteredTasks = tasks.map((task: PlannerTask) => ({
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
