import { db, pinnedItem } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { deletePinnedItemContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('PinnedItemDeleteAPI')

type RouteContext = { params: Promise<{ resourceType: string; resourceId: string }> }

/** Unpins a resource, identified by the composite key (`resourceType`, `resourceId`). */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(deletePinnedItemContract, request, context)
  if (!parsed.success) return parsed.response
  const { resourceType, resourceId } = parsed.data.params

  const deleted = await db
    .delete(pinnedItem)
    .where(
      and(
        eq(pinnedItem.userId, session.user.id),
        eq(pinnedItem.resourceType, resourceType),
        eq(pinnedItem.resourceId, resourceId)
      )
    )
    .returning({ id: pinnedItem.id })

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'Pinned item not found' }, { status: 404 })
  }

  logger.info('Unpinned resource', { resourceType, resourceId, userId: session.user.id })

  return NextResponse.json({ success: true })
})
