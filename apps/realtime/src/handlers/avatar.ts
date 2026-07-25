import { db, user } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { AuthenticatedSocket } from '@/middleware/auth'

const logger = createLogger('PresenceAvatar')

/**
 * The avatar URL for a presence entry: the socket's authenticated image when
 * present, otherwise a single lookup of the user's stored image. Never throws —
 * presence must not fail on an avatar lookup, so a DB error resolves to `null`.
 */
export async function resolveAvatarUrl(
  socket: AuthenticatedSocket,
  userId: string
): Promise<string | null> {
  if (socket.userImage) return socket.userImage
  try {
    const [record] = await db
      .select({ image: user.image })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    return record?.image ?? null
  } catch (error) {
    logger.warn('Failed to load user avatar for presence', { userId, error })
    return null
  }
}
