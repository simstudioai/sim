import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { createWorkdaySoapClient, extractRefId, wdRef } from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayTerminateAPI')

const RequestSchema = z.object({
  tenantUrl: z.string().min(1),
  tenant: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  workerId: z.string().min(1),
  terminationDate: z.string().min(1),
  reason: z.string().min(1),
  notificationDate: z.string().optional(),
  lastDayOfWork: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const data = RequestSchema.parse(body)

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
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
