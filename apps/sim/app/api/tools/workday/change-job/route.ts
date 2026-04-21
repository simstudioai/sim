import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createWorkdaySoapClient, extractRefId, wdRef } from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayChangeJobAPI')

const RequestSchema = z.object({
  tenantUrl: z.string().min(1),
  tenant: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  workerId: z.string().min(1),
  effectiveDate: z.string().min(1),
  newPositionId: z.string().optional(),
  newJobProfileId: z.string().optional(),
  newLocationId: z.string().optional(),
  newSupervisoryOrgId: z.string().optional(),
  reason: z.string().min(1, 'Reason is required for job changes'),
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

    const changeJobDetailData: Record<string, unknown> = {
      Reason_Reference: wdRef('Change_Job_Subcategory_ID', data.reason),
    }
    if (data.newPositionId) {
      changeJobDetailData.Position_Reference = wdRef('Position_ID', data.newPositionId)
    }
    if (data.newJobProfileId) {
      changeJobDetailData.Job_Profile_Reference = wdRef('Job_Profile_ID', data.newJobProfileId)
    }
    if (data.newLocationId) {
      changeJobDetailData.Location_Reference = wdRef('Location_ID', data.newLocationId)
    }
    if (data.newSupervisoryOrgId) {
      changeJobDetailData.Supervisory_Organization_Reference = wdRef(
        'Supervisory_Organization_ID',
        data.newSupervisoryOrgId
      )
    }

    const client = await createWorkdaySoapClient(
      data.tenantUrl,
      data.tenant,
      'staffing',
      data.username,
      data.password
    )

    const [result] = await client.Change_JobAsync({
      Business_Process_Parameters: {
        Auto_Complete: true,
        Run_Now: true,
      },
      Change_Job_Data: {
        Worker_Reference: wdRef('Employee_ID', data.workerId),
        Effective_Date: data.effectiveDate,
        Change_Job_Detail_Data: changeJobDetailData,
      },
    })

    const eventRef = result?.Event_Reference

    return NextResponse.json({
      success: true,
      output: {
        eventId: extractRefId(eventRef),
        workerId: data.workerId,
        effectiveDate: data.effectiveDate,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Workday change job failed`, { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
})
