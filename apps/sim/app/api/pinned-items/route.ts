import { db, pinnedItem } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createPinnedItemContract, listPinnedItemsContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { filterToActiveResources, pinnableResourceExists } from '@/lib/pinned-items/resources'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('PinnedItemsAPI')

function toPinnedItemApi(row: typeof pinnedItem.$inferSelect) {
  return { ...row, pinnedAt: row.pinnedAt.toISOString() }
}

/** Lists the session user's pinned items in a workspace, optionally filtered to one `resourceType`. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(listPinnedItemsContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId, resourceType } = parsed.data.query

  const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (!permission) {
    return NextResponse.json({ error: 'Access denied to this workspace' }, { status: 403 })
  }

  const rows = await db
    .select()
    .from(pinnedItem)
    .where(
      and(
        eq(pinnedItem.userId, session.user.id),
        eq(pinnedItem.workspaceId, workspaceId),
        resourceType ? eq(pinnedItem.resourceType, resourceType) : undefined
      )
    )

  const activeRows = await filterToActiveResources(rows, workspaceId)

  return NextResponse.json({ pinnedItems: activeRows.map(toPinnedItemApi) })
})

/** Pins a resource for the session user. Idempotent from the client's perspective: re-pinning returns 409. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(createPinnedItemContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId, resourceType, resourceId } = parsed.data.body

  const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (!permission) {
    return NextResponse.json({ error: 'Access denied to this workspace' }, { status: 403 })
  }

  if (!(await pinnableResourceExists(resourceType, resourceId, workspaceId))) {
    return NextResponse.json({ error: 'Resource not found in this workspace' }, { status: 404 })
  }

  try {
    const [created] = await db
      .insert(pinnedItem)
      .values({
        id: generateId(),
        userId: session.user.id,
        workspaceId,
        resourceType,
        resourceId,
      })
      .returning()

    return NextResponse.json({ pinnedItem: toPinnedItemApi(created) }, { status: 201 })
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505') {
      return NextResponse.json({ error: 'This item is already pinned' }, { status: 409 })
    }
    logger.error('Failed to pin resource', { error, resourceType, resourceId })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
