import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count, eq, ilike, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const logger = createLogger('ImpersonateSearchAPI')

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

/**
 * GET /api/admin/impersonate/search
 *
 * Search for users to impersonate. Only accessible by superadmins.
 *
 * Query params:
 *   - q: Search term (searches name and email)
 *   - limit: Number of results per page (default: 10, max: 50)
 *   - offset: Number of results to skip (default: 0)
 *
 * Response: { users: Array<{ id, name, email, image, role, createdAt }>, pagination: { total, limit, offset } }
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return new NextResponse(null, { status: 404 })
    }

    const [currentUser] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    if (currentUser?.role !== 'superadmin') {
      return new NextResponse(null, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')?.trim()
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10)),
      MAX_LIMIT
    )
    const offset = Math.max(0, Number.parseInt(searchParams.get('offset') || '0', 10))

    if (!query || query.length < 2) {
      return NextResponse.json({
        users: [],
        pagination: { total: 0, limit, offset },
      })
    }

    const searchPattern = `%${query}%`
    const whereCondition = or(ilike(user.name, searchPattern), ilike(user.email, searchPattern))

    const [totalResult] = await db.select({ count: count() }).from(user).where(whereCondition)

    const users = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(whereCondition)
      .limit(limit)
      .offset(offset)

    logger.info(`Superadmin ${session.user.id} searched for users with query: ${query}`)

    return NextResponse.json({
      users: users.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      })),
      pagination: {
        total: totalResult?.count ?? 0,
        limit,
        offset,
      },
    })
  } catch (error) {
    logger.error('Failed to search users for impersonation', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
