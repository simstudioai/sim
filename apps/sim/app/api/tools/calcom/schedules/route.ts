import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { calcomSchedulesSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('CalcomSchedulesAPI')

export const dynamic = 'force-dynamic'

interface CalcomSchedule {
  id: number
  name: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(calcomSchedulesSelectorContract, request, {})
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
      logger.error('Failed to get access token', {
        credentialId: credential,
        userId: authz.credentialOwnerUserId,
      })
      return NextResponse.json(
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }

    const response = await fetch('https://api.cal.com/v2/schedules', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'cal-api-version': '2024-06-11',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Cal.com schedules', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Cal.com schedules', details: errorData },
        { status: response.status }
      )
    }

    const data = (await response.json()) as { data?: CalcomSchedule[] }
    const schedules = (data.data || []).map((schedule) => ({
      id: String(schedule.id),
      name: schedule.name,
    }))

    return NextResponse.json({ schedules })
  } catch (error) {
    logger.error('Error processing Cal.com schedules request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Cal.com schedules', details: (error as Error).message },
      { status: 500 }
    )
  }
})
