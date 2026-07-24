import { db } from '@sim/db'
import { workflowBlockAnnotation } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  deleteWorkflowAnnotationContract,
  updateWorkflowAnnotationContract,
} from '@/lib/api/contracts/workflow-annotations'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { notifyAnnotationsUpdated, serializeWorkflowAnnotation } from '@/lib/workflows/annotations'

const logger = createLogger('WorkflowAnnotationAPI')

type RouteContext = { params: Promise<{ id: string; annotationId: string }> }

export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(updateWorkflowAnnotationContract, request, context)
  if (!parsed.success) return parsed.response

  const { id, annotationId } = parsed.data.params
  const { content, resolved } = parsed.data.body

  const auth = await authorizeWorkflowByWorkspacePermission({
    workflowId: id,
    userId: session.user.id,
    action: 'write',
  })
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.message ?? 'Access denied' }, { status: auth.status })
  }

  const [existing] = await db
    .select()
    .from(workflowBlockAnnotation)
    .where(
      and(eq(workflowBlockAnnotation.id, annotationId), eq(workflowBlockAnnotation.workflowId, id))
    )
    .limit(1)
  if (!existing) {
    return NextResponse.json({ error: 'Annotation not found' }, { status: 404 })
  }

  if (content !== undefined && existing.createdBy !== session.user.id) {
    return NextResponse.json(
      { error: 'Only the comment author can edit its content' },
      { status: 403 }
    )
  }

  const updates: Partial<typeof workflowBlockAnnotation.$inferInsert> = { updatedAt: new Date() }
  if (content !== undefined) {
    updates.content = content
  }
  if (resolved !== undefined && resolved !== existing.resolved) {
    updates.resolved = resolved
    updates.resolvedBy = resolved ? session.user.id : null
    updates.resolvedAt = resolved ? new Date() : null
  }

  const [updated] = await db
    .update(workflowBlockAnnotation)
    .set(updates)
    .where(eq(workflowBlockAnnotation.id, annotationId))
    .returning()

  logger.info('Updated block annotation', { workflowId: id, annotationId })
  void notifyAnnotationsUpdated(id)

  return NextResponse.json({ annotation: serializeWorkflowAnnotation(updated) })
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(deleteWorkflowAnnotationContract, request, context)
  if (!parsed.success) return parsed.response

  const { id, annotationId } = parsed.data.params

  const auth = await authorizeWorkflowByWorkspacePermission({
    workflowId: id,
    userId: session.user.id,
    action: 'write',
  })
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.message ?? 'Access denied' }, { status: auth.status })
  }

  const [existing] = await db
    .select()
    .from(workflowBlockAnnotation)
    .where(
      and(eq(workflowBlockAnnotation.id, annotationId), eq(workflowBlockAnnotation.workflowId, id))
    )
    .limit(1)
  if (!existing) {
    return NextResponse.json({ error: 'Annotation not found' }, { status: 404 })
  }

  const isAuthor = existing.createdBy === session.user.id
  const isAdmin = auth.workspacePermission === 'admin'
  if (!isAuthor && !isAdmin) {
    return NextResponse.json(
      { error: 'Only the comment author or a workspace admin can delete this comment' },
      { status: 403 }
    )
  }

  await db.delete(workflowBlockAnnotation).where(eq(workflowBlockAnnotation.id, annotationId))

  logger.info('Deleted block annotation', { workflowId: id, annotationId })
  void notifyAnnotationsUpdated(id)

  return NextResponse.json({ success: true })
})
