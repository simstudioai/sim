import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createWorkdaySoapClient,
  extractRefId,
  normalizeSoapArray,
  type WorkdayCompensationDataSoap,
  type WorkdayCompensationPlanSoap,
  type WorkdayWorkerSoap,
} from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayGetCompensationAPI')

const RequestSchema = z.object({
  tenantUrl: z.string().min(1),
  tenant: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  workerId: z.string().min(1),
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

    const worker =
      normalizeSoapArray(
        result?.Response_Data?.Worker as WorkdayWorkerSoap | WorkdayWorkerSoap[] | undefined
      )[0] ?? null
    const compensationData = worker?.Worker_Data?.Compensation_Data

    const mapPlan = (p: WorkdayCompensationPlanSoap) => ({
      id: extractRefId(p.Compensation_Plan_Reference) ?? null,
      planName: p.Compensation_Plan_Reference?.attributes?.Descriptor ?? null,
      amount: p.Amount ?? p.Per_Unit_Amount ?? p.Individual_Target_Amount ?? null,
      currency: extractRefId(p.Currency_Reference) ?? null,
      frequency: extractRefId(p.Frequency_Reference) ?? null,
    })

    const planTypeKeys: (keyof WorkdayCompensationDataSoap)[] = [
      'Employee_Base_Pay_Plan_Assignment_Data',
      'Employee_Salary_Unit_Plan_Assignment_Data',
      'Employee_Bonus_Plan_Assignment_Data',
      'Employee_Allowance_Plan_Assignment_Data',
      'Employee_Commission_Plan_Assignment_Data',
      'Employee_Stock_Plan_Assignment_Data',
      'Employee_Period_Salary_Plan_Assignment_Data',
    ]

    const compensationPlans: ReturnType<typeof mapPlan>[] = []
    for (const key of planTypeKeys) {
      for (const plan of normalizeSoapArray(compensationData?.[key])) {
        compensationPlans.push(mapPlan(plan))
      }
    }

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
})
