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
  type WorkdayWorkerSoap,
} from '@/tools/workday/soap'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkdayListWorkersAPI')

const RequestSchema = z.object({
  tenantUrl: z.string().min(1),
  tenant: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  limit: z.number().optional(),
  offset: z.number().optional(),
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

    const limit = data.limit ?? 20
    const offset = data.offset ?? 0
    const page = offset > 0 ? Math.floor(offset / limit) + 1 : 1

    const [result] = await client.Get_WorkersAsync({
      Response_Filter: { Page: page, Count: limit },
      Response_Group: {
        Include_Reference: true,
        Include_Personal_Information: true,
        Include_Employment_Information: true,
      },
    })

    const workersArray = normalizeSoapArray(
      result?.Response_Data?.Worker as WorkdayWorkerSoap | WorkdayWorkerSoap[] | undefined
    )

    const workers = workersArray.map((w) => ({
      id: extractRefId(w.Worker_Reference) ?? null,
      descriptor: w.Worker_Descriptor ?? null,
      personalData: w.Worker_Data?.Personal_Data ?? null,
      employmentData: w.Worker_Data?.Employment_Data ?? null,
    }))

    const total = result?.Response_Results?.Total_Results ?? workers.length

    return NextResponse.json({
      success: true,
      output: { workers, total },
    })
  } catch (error) {
    logger.error(`[${requestId}] Workday list workers failed`, { error })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
})
