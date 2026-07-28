import { db, pinnedItem } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { deletePinnedItemContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('PinnedItemDeleteAPI')

interface RouteContext {
  params: Promise<{ resourceType: string; resourceId: string }>
}

/**
 * Unpins a resource, addressed by its composite key rather than the pin's own id so
 * callers can unpin from a resource row without first looking the pin up.
 *
 * No workspace permission check is needed: the delete is scoped to the session
 * user's own pins, so a caller can only ever remove a row they created.
 */
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

  logger.info('Unpinned resource', { resourceType, resourceId })

  return NextResponse.json({ success: true })
})
