import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createWorkdaySoapClient, extractRefId, wdRef } from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayHireAPI')

const RequestSchema = z.object({
  tenantUrl: z.string().min(1),
  tenant: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  preHireId: z.string().min(1),
  positionId: z.string().min(1),
  hireDate: z.string().min(1),
  employeeType: z.string().optional(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
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

    const [result] = await client.Hire_EmployeeAsync({
      Business_Process_Parameters: {
        Auto_Complete: true,
        Run_Now: true,
      },
      Hire_Employee_Data: {
        Applicant_Reference: wdRef('Applicant_ID', data.preHireId),
        Position_Reference: wdRef('Position_ID', data.positionId),
        Hire_Date: data.hireDate,
        Hire_Employee_Event_Data: {
          Employee_Type_Reference: wdRef('Employee_Type_ID', data.employeeType ?? 'Regular'),
          First_Day_of_Work: data.hireDate,
        },
      },
    })

    const employeeRef = result?.Employee_Reference
    const eventRef = result?.Event_Reference

    return NextResponse.json({
      success: true,
      output: {
        workerId: extractRefId(employeeRef),
        employeeId: extractRefId(employeeRef),
        eventId: extractRefId(eventRef),
        hireDate: data.hireDate,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Workday hire employee failed`, { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
})
