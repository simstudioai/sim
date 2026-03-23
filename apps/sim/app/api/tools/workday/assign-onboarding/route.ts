import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { createWorkdaySoapClient, extractRefId, wdRef } from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayAssignOnboardingAPI')

const RequestSchema = z.object({
  tenantUrl: z.string().min(1),
  tenant: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  workerId: z.string().min(1),
  onboardingPlanId: z.string().min(1),
  actionEventId: z.string().min(1),
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

    const [result] = await client.Put_Onboarding_Plan_AssignmentAsync({
      Onboarding_Plan_Assignment_Data: {
        Onboarding_Plan_Reference: wdRef('Onboarding_Plan_ID', data.onboardingPlanId),
        Person_Reference: wdRef('WID', data.workerId),
        Action_Event_Reference: wdRef('Background_Check_ID', data.actionEventId),
        Assignment_Effective_Moment: new Date().toISOString(),
        Active: true,
      },
    })

    return NextResponse.json({
      success: true,
      output: {
        assignmentId: extractRefId(result?.Onboarding_Plan_Assignment_Reference),
        workerId: data.workerId,
        planId: data.onboardingPlanId,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Workday assign onboarding failed`, { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
