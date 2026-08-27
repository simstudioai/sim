import { type NextRequest, NextResponse } from 'next/server'
import { cancelWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { cancelWorkflowExecutionPostAuth } from '@/lib/execution/cancel-workflow-execution-post-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; executionId: string }> }) => {
    const auth = await checkHybridAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(cancelWorkflowExecutionContract, req, context)
    if (!parsed.success) return parsed.response

    return cancelWorkflowExecutionPostAuth({
      workflowId: parsed.data.params.id,
      executionId: parsed.data.params.executionId,
      userId: auth.userId,
      ...(auth.apiKeyType === 'workspace'
        ? { workspaceApiKeyScope: { workspaceId: auth.workspaceId } }
        : {}),
    })
  }
)
