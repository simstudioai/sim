import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { workdayGetWorkerContract } from '@/lib/api/contracts/tools/workday'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createWorkdaySoapClient,
  extractRefId,
  normalizeSoapArray,
  type WorkdayWorkerSoap,
} from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayGetWorkerAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(workdayGetWorkerContract, request, {})
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    const client = await createWorkdaySoapClient(
      data.tenantUrl,
      data.tenant,
      'humanResources',
      data.username,
      data.password
    )

    const [result] = await client.Get_WorkersAsync({
      Request_References: {
        Worker_Reference: {
          ID: { attributes: { 'wd:type': 'Employee_ID' }, $value: data.workerId },
        },
      },
      Response_Group: {
        Include_Reference: true,
        Include_Personal_Information: true,
        Include_Employment_Information: true,
        Include_Compensation: true,
        Include_Organizations: true,
      },
    })

    const worker =
      normalizeSoapArray(
        result?.Response_Data?.Worker as WorkdayWorkerSoap | WorkdayWorkerSoap[] | undefined
      )[0] ?? null

    return NextResponse.json({
      success: true,
      output: {
        worker: worker
          ? {
              id: extractRefId(worker.Worker_Reference) ?? null,
              descriptor: worker.Worker_Descriptor ?? null,
              personalData: worker.Worker_Data?.Personal_Data ?? null,
              employmentData: worker.Worker_Data?.Employment_Data ?? null,
              compensationData: worker.Worker_Data?.Compensation_Data ?? null,
              organizationData: worker.Worker_Data?.Organization_Data ?? null,
            }
          : null,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Workday get worker failed`, { error })
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
})
