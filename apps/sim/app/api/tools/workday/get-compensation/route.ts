import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { createWorkdaySoapClient } from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayGetCompensationAPI')

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
        Include_Compensation: true,
      },
    })

    const rawWorker = result?.Response_Data?.Worker
    const workerData = (Array.isArray(rawWorker) ? rawWorker[0] : (rawWorker ?? null)) as Record<
      string,
      unknown
    > | null
    const workerInner = workerData?.Worker_Data as Record<string, unknown> | undefined
    const compensationData = workerInner?.Compensation_Data as Record<string, unknown> | undefined

    const rawPlans = compensationData?.Compensation_Plan_Assignment
    const plansArray = (Array.isArray(rawPlans) ? rawPlans : rawPlans ? [rawPlans] : []) as Record<
      string,
      unknown
    >[]

    const compensationPlans = plansArray.map((p) => ({
      ...p,
    }))

    return NextResponse.json({
      success: true,
      output: { compensationPlans },
    })
  } catch (error) {
    logger.error(`[${requestId}] Workday get compensation failed`, { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
