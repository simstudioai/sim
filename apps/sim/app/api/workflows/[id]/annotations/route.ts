import { db } from '@sim/db'
import { workflowBlockAnnotation } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { generateId } from '@sim/utils/id'
import { asc, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  createWorkflowAnnotationContract,
  listWorkflowAnnotationsContract,
} from '@/lib/api/contracts/workflow-annotations'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { notifyAnnotationsUpdated, serializeWorkflowAnnotation } from '@/lib/workflows/annotations'

const logger = createLogger('WorkflowAnnotationsAPI')

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(listWorkflowAnnotationsContract, request, context)
  if (!parsed.success) return parsed.response

  const { id } = parsed.data.params

  const auth = await authorizeWorkflowByWorkspacePermission({
    workflowId: id,
    userId: session.user.id,
    action: 'read',
  })
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.message ?? 'Access denied' }, { status: auth.status })
  }

  const rows = await db
    .select()
    .from(workflowBlockAnnotation)
    .where(eq(workflowBlockAnnotation.workflowId, id))
    .orderBy(asc(workflowBlockAnnotation.createdAt))

  return NextResponse.json({ annotations: rows.map(serializeWorkflowAnnotation) })
})

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(createWorkflowAnnotationContract, request, context)
  if (!parsed.success) return parsed.response

  const { id } = parsed.data.params
  const { blockId, content } = parsed.data.body

  const auth = await authorizeWorkflowByWorkspacePermission({
    workflowId: id,
    userId: session.user.id,
    action: 'write',
  })
  if (!auth.allowed) {
    return NextResponse.json({ error: auth.message ?? 'Access denied' }, { status: auth.status })
  }

  const [created] = await db
    .insert(workflowBlockAnnotation)
    .values({
      id: generateId(),
      workflowId: id,
      blockId,
      content,
      createdBy: session.user.id,
    })
    .returning()

  logger.info('Created block annotation', { workflowId: id, blockId })
  void notifyAnnotationsUpdated(id)

  return NextResponse.json({ annotation: serializeWorkflowAnnotation(created) })
})
