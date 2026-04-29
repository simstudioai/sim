import { type NextRequest, NextResponse } from 'next/server'
import { pausedWorkflowExecutionsQuerySchema } from '@/lib/api/contracts/workflows'
import { getValidationErrorMessage, validateSchema } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(
  async (
    request: NextRequest,
    {
      params,
    }: {
      params: Promise<{ id: string }>
    }
  ) => {
    const { id: workflowId } = await params

    const access = await validateWorkflowAccess(request, workflowId, false)
    if (access.error) {
      return NextResponse.json({ error: access.error.message }, { status: access.error.status })
    }

    const validation = validateSchema(
      pausedWorkflowExecutionsQuerySchema,
      { status: request.nextUrl.searchParams.get('status') },
      'Invalid query parameters'
    )

    if (!validation.success) {
      return NextResponse.json(
        {
          error: getValidationErrorMessage(validation.error, 'Invalid query parameters'),
        },
        { status: 400 }
      )
    }

    const { status: statusFilter } = validation.data

    const pausedExecutions = await PauseResumeManager.listPausedExecutions({
      workflowId,
      status: statusFilter,
    })

    return NextResponse.json({ pausedExecutions })
  }
)
