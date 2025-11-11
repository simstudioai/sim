import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'

const queryParamsSchema = z.object({
  status: z.string().optional(),
})

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: { id: string }
  }
) {
  const workflowId = params.id

  const access = await validateWorkflowAccess(request, workflowId, false)
  if (access.error) {
    return NextResponse.json({ error: access.error.message }, { status: access.error.status })
  }

  const validation = queryParamsSchema.safeParse({
    status: request.nextUrl.searchParams.get('status'),
  })

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.errors[0]?.message || 'Invalid query parameters' },
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
