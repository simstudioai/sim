import { type NextRequest, NextResponse } from 'next/server'
import { workflowExecutionParamsSchema } from '@/lib/api/contracts/workflows'
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
      params: Promise<{ id: string; executionId: string }>
    }
  ) => {
    const paramsValidation = validateSchema(
      workflowExecutionParamsSchema,
      await params,
      'Invalid route parameters'
    )
    if (!paramsValidation.success) {
      return NextResponse.json(
        {
          error: getValidationErrorMessage(paramsValidation.error, 'Invalid route parameters'),
        },
        { status: 400 }
      )
    }
    const { id: workflowId, executionId } = paramsValidation.data

    const access = await validateWorkflowAccess(request, workflowId, false)
    if (access.error) {
      return NextResponse.json({ error: access.error.message }, { status: access.error.status })
    }

    const detail = await PauseResumeManager.getPausedExecutionDetail({
      workflowId,
      executionId,
    })

    if (!detail) {
      return NextResponse.json({ error: 'Paused execution not found' }, { status: 404 })
    }

    return NextResponse.json(detail)
  }
)
