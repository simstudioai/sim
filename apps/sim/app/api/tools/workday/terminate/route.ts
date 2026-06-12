import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { workdayTerminateContract } from '@/lib/api/contracts/tools/workday'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createWorkdaySoapClient, extractRefId, wdRef } from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayTerminateAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(workdayTerminateContract, request, {})
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    const client = await createWorkdaySoapClient(
      data.tenantUrl,
      data.tenant,
      'staffing',
      data.username,
      data.password
    )

    const [result] = await client.Terminate_EmployeeAsync({
      Business_Process_Parameters: {
        Auto_Complete: true,
        Run_Now: true,
      },
      Terminate_Employee_Data: {
        Employee_Reference: wdRef('Employee_ID', data.workerId),
        Termination_Date: data.terminationDate,
        Terminate_Event_Data: {
          Primary_Reason_Reference: wdRef('Termination_Subcategory_ID', data.reason),
          Last_Day_of_Work: data.lastDayOfWork ?? data.terminationDate,
          Notification_Date: data.notificationDate ?? data.terminationDate,
        },
      },
    })

    const eventRef = result?.Event_Reference

    return NextResponse.json({
      success: true,
      output: {
        eventId: extractRefId(eventRef),
        workerId: data.workerId,
        terminationDate: data.terminationDate,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Workday terminate employee failed`, { error })
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
})
