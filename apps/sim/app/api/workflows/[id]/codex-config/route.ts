import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateWorkflowCodexConfigContract } from '@/lib/api/contracts/codex-config'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { compactCodexWorkflowConfig, parseCodexWorkflowConfig } from '@/lib/codex/config'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkflowCodexConfigAPI')

async function loadAuthorizedWorkflow(workflowId: string, requireWrite: boolean) {
  const session = await getSession()
  if (!session?.user?.id)
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const [row] = await db
    .select({
      id: workflow.id,
      userId: workflow.userId,
      workspaceId: workflow.workspaceId,
      config: workflow.codexConfig,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  if (!row) return { response: NextResponse.json({ error: 'Workflow not found' }, { status: 404 }) }

  if (!row.workspaceId) {
    if (row.userId !== session.user.id) {
      return { response: NextResponse.json({ error: 'Workflow not found' }, { status: 404 }) }
    }
    return { row, userId: session.user.id }
  }

  const permission = await getUserEntityPermissions(session.user.id, 'workspace', row.workspaceId)
  if (!permission || (requireWrite && !permissionSatisfies(permission, 'write'))) {
    return { response: NextResponse.json({ error: 'Workflow not found' }, { status: 404 }) }
  }
  return { row, userId: session.user.id }
}

export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const workflowId = (await params).id
    const auth = await loadAuthorizedWorkflow(workflowId, false)
    if (auth.response) return auth.response
    return NextResponse.json({ config: parseCodexWorkflowConfig(auth.row.config) })
  }
)

export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const workflowId = (await context.params).id
    const auth = await loadAuthorizedWorkflow(workflowId, true)
    if (auth.response) return auth.response

    const parsed = await parseRequest(updateWorkflowCodexConfigContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const config = compactCodexWorkflowConfig(parseCodexWorkflowConfig(parsed.data.body.config))
      const [updated] = await db
        .update(workflow)
        .set({ codexConfig: config, updatedAt: new Date() })
        .where(eq(workflow.id, workflowId))
        .returning({ config: workflow.codexConfig })
      if (!updated) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      return NextResponse.json({ config: parseCodexWorkflowConfig(updated.config) })
    } catch (error) {
      logger.error('Failed to update workflow Codex configuration', {
        workflowId,
        userId: auth.userId,
        error: getErrorMessage(error),
      })
      return NextResponse.json({ error: 'Failed to update Codex configuration' }, { status: 500 })
    }
  }
)
