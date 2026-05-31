import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftPlannerPlansSelectorContract } from '@/lib/api/contracts/selectors/microsoft'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { assertGraphNextPageUrl, getGraphNextPageUrl } from '@/tools/sharepoint/utils'

const logger = createLogger('MicrosoftPlannerPlansAPI')

export const dynamic = 'force-dynamic'

/**
 * Upper bound on Microsoft Graph pages drained when listing Planner plans.
 * Planner uses server-side paging (`$top` is generally ignored), so this caps
 * the `@odata.nextLink` follow loop to prevent an unbounded drain.
 */
const MAX_PLANS_PAGES = 20

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsed = await parseRequest(microsoftPlannerPlansSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId } = parsed.data.body

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

    let nextUrl: string | undefined = 'https://graph.microsoft.com/v1.0/me/planner/plans'

    const rawPlans: { id: string; title: string }[] = []
    for (let page = 0; page < MAX_PLANS_PAGES && nextUrl; page++) {
      const response = await fetch(nextUrl, {
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
      if (Array.isArray(data.value)) {
        rawPlans.push(...data.value)
      }

      const nextLink = getGraphNextPageUrl(data)
      nextUrl = nextLink ? assertGraphNextPageUrl(nextLink) : undefined
      if (nextUrl && page === MAX_PLANS_PAGES - 1) {
        logger.warn(
          `[${requestId}] Planner plans pagination hit ${MAX_PLANS_PAGES}-page cap; result may be incomplete`
        )
      }
    }

    const filteredPlans = rawPlans.map((plan: { id: string; title: string }) => ({
      id: plan.id,
      title: plan.title,
    }))

    return NextResponse.json({ plans: filteredPlans })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Microsoft Planner plans:`, error)
    return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 })
  }
})
