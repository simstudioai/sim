import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('MicrosoftPlannerPlansAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: Request) => {
  const requestId = generateRequestId()

  try {
    const body = await request.json()
    const { credential, workflowId } = body

    if (!credential) {
      logger.error(`[${requestId}] Missing credential in request`)
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
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

    const response = await fetch('https://graph.microsoft.com/v1.0/me/planner/plans', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Microsoft Graph API error:`, errorText)
      return NextResponse.json(
        { error: 'Failed to fetch plans from Microsoft Graph' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const plans = data.value || []

    const filteredPlans = plans.map((plan: { id: string; title: string }) => ({
      id: plan.id,
      title: plan.title,
    }))

    return NextResponse.json({ plans: filteredPlans })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Microsoft Planner plans:`, error)
    return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 })
  }
})
