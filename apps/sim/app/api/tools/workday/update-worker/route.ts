import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { workdayUpdateWorkerContract } from '@/lib/api/contracts/tools/workday'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createWorkdaySoapClient, extractRefId, wdRef } from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayUpdateWorkerAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(workdayUpdateWorkerContract, request, {})
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    const client = await createWorkdaySoapClient(
      data.tenantUrl,
      data.tenant,
      'humanResources',
      data.username,
      data.password
    )

    const [result] = await client.Change_Personal_InformationAsync({
      Business_Process_Parameters: {
        Auto_Complete: true,
        Run_Now: true,
      },
      Change_Personal_Information_Data: {
        Person_Reference: wdRef('Employee_ID', data.workerId),
        Personal_Information_Data: data.fields,
      },
    })

    return NextResponse.json({
      success: true,
      output: {
        eventId: extractRefId(result?.Personal_Information_Change_Event_Reference),
        workerId: data.workerId,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Workday update worker failed`, { error })
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
})
