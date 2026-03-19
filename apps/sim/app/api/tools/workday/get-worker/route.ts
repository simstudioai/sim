import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { createWorkdaySoapClient, extractRefId, type WorkdayReference } from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayGetWorkerAPI')

const RequestSchema = z.object({
  tenantUrl: z.string().min(1),
  tenant: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  workerId: z.string().min(1),
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

    const rawWorker = result?.Response_Data?.Worker
    const workerData = (Array.isArray(rawWorker) ? rawWorker[0] : (rawWorker ?? null)) as Record<
      string,
      unknown
    > | null
    const workerInner = (workerData?.Worker_Data ?? null) as Record<string, unknown> | null

    return NextResponse.json({
      success: true,
      output: {
        worker: workerData
          ? {
              id: extractRefId(workerData.Worker_Reference as WorkdayReference | undefined) ?? null,
              descriptor: (workerData.Worker_Descriptor as string) ?? null,
              personalData: workerInner?.Personal_Data ?? null,
              employmentData: workerInner?.Employment_Data ?? null,
              compensationData: workerInner?.Compensation_Data ?? null,
              organizationData: workerInner?.Organization_Data ?? null,
            }
          : null,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Workday get worker failed`, { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
