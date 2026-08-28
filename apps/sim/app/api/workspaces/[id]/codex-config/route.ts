import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateWorkspaceCodexConfigContract } from '@/lib/api/contracts/codex-config'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { parseCodexConfigPatch } from '@/lib/codex/config'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceCodexConfigAPI')

async function authorize(workspaceId: string, requireWrite: boolean) {
  const session = await getSession()
  if (!session?.user?.id)
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (!permission || (requireWrite && !permissionSatisfies(permission, 'write'))) {
    return { response: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }) }
  }
  return { userId: session.user.id }
}

export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const workspaceId = (await params).id
    const auth = await authorize(workspaceId, false)
    if (auth.response) return auth.response

    const [row] = await db
      .select({ config: workspace.codexConfig })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)
    if (!row) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    return NextResponse.json({ config: parseCodexConfigPatch(row.config) })
  }
)

export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const workspaceId = (await context.params).id
    const auth = await authorize(workspaceId, true)
    if (auth.response) return auth.response

    const parsed = await parseRequest(updateWorkspaceCodexConfigContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const config = parseCodexConfigPatch(parsed.data.body.config)
      const [updated] = await db
        .update(workspace)
        .set({ codexConfig: config, updatedAt: new Date() })
        .where(eq(workspace.id, workspaceId))
        .returning({ config: workspace.codexConfig })
      if (!updated) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      return NextResponse.json({ config: parseCodexConfigPatch(updated.config) })
    } catch (error) {
      logger.error('Failed to update workspace Codex configuration', {
        workspaceId,
        userId: auth.userId,
        error: getErrorMessage(error),
      })
      return NextResponse.json({ error: 'Failed to update Codex configuration' }, { status: 500 })
    }
  }
)
