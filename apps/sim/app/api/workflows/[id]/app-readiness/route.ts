import { db } from '@sim/db'
import { appProject, appRevisionAction, workflow } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { buildBoundActionEntryFromDraft } from '@/lib/apps/bind-actions'
import { getSession } from '@/lib/auth'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: workflowId } = await context.params
  const [workflowRow] = await db
    .select({ id: workflow.id, name: workflow.name, workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
    .limit(1)
  if (!workflowRow) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  if (!workflowRow.workspaceId) {
    return NextResponse.json({ error: 'Workflow is not in a workspace' }, { status: 400 })
  }
  const permission = await getUserEntityPermissions(
    session.user.id,
    'workspace',
    workflowRow.workspaceId
  )
  if (permission !== 'write' && permission !== 'admin') {
    return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
  }

  const readiness = await buildBoundActionEntryFromDraft({
    workspaceId: workflowRow.workspaceId,
    workflowId,
    actionId: 'main',
  })
  const rows = await db
    .select({
      id: appProject.id,
      name: appProject.name,
      updatedAt: appProject.updatedAt,
      chatId: appProject.lastBuilderChatId,
      createdFromChatId: appProject.createdFromChatId,
    })
    .from(appProject)
    .innerJoin(appRevisionAction, eq(appProject.draftRevisionId, appRevisionAction.revisionId))
    .where(
      and(
        eq(appProject.workspaceId, workflowRow.workspaceId),
        eq(appRevisionAction.workflowId, workflowId),
        isNull(appProject.archivedAt)
      )
    )

  const credentialRequired = !readiness.ok && readiness.code === 'OAUTH_UNBOUND'
  return NextResponse.json({
    ready: readiness.ok || credentialRequired,
    credentialRequired,
    workflow: workflowRow,
    ...(readiness.ok
      ? {
          inputSchema: readiness.action.inputSchema,
          outputCount: readiness.action.outputAllowlist.length,
        }
      : { code: readiness.code, message: readiness.error }),
    existingApps: rows.map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt.toISOString(),
      chatId: row.chatId || row.createdFromChatId,
    })),
  })
}
