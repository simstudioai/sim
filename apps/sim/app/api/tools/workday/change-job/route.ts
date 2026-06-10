import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { workdayChangeJobContract } from '@/lib/api/contracts/tools/workday'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createWorkdaySoapClient, extractRefId, wdRef } from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayChangeJobAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(workdayChangeJobContract, request, {})
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    const changeJobDetailData: Record<string, unknown> = {
      Reason_Reference: wdRef('Change_Job_Subcategory_ID', data.reason),
    }
    if (data.newSupervisoryOrgId) {
      changeJobDetailData.Supervisory_Organization_Reference = wdRef(
        'Organization_Reference_ID',
        data.newSupervisoryOrgId
      )
    }
    if (data.newPositionId) {
      changeJobDetailData.Proposed_Position_Reference = wdRef('Position_ID', data.newPositionId)
    }
    const jobDetailsData: Record<string, unknown> = {}
    if (data.newJobProfileId) {
      jobDetailsData.Job_Profile_Reference = wdRef('Job_Profile_ID', data.newJobProfileId)
    }
    if (data.newLocationId) {
      jobDetailsData.Location_Reference = wdRef('Location_ID', data.newLocationId)
    }
    if (Object.keys(jobDetailsData).length > 0) {
      changeJobDetailData.Job_Details_Data = jobDetailsData
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
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
})
