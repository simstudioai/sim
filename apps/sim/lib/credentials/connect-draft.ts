import { db } from '@sim/db'
import { pendingCredentialDraft, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, lt } from 'drizzle-orm'
import { getAllOAuthServices } from '@/lib/oauth/utils'

const logger = createLogger('OAuthConnectDraft')
const DRAFT_TTL_MS = 15 * 60 * 1000

/**
 * Creates the pending credential draft at OAuth click time so custom and
 * generic OAuth callbacks can materialize the connected workspace credential.
 */
export async function createConnectDraft(params: {
  userId: string
  workspaceId: string
  providerId: string
}): Promise<void> {
  const { userId, workspaceId, providerId } = params
  const service = getAllOAuthServices().find((candidate) => candidate.providerId === providerId)

  let displayName = service?.name ?? providerId
  try {
    const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId))
    if (row?.name) {
      displayName = `${row.name}'s ${displayName}`
    }
  } catch {
    // Fall back to the service name.
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + DRAFT_TTL_MS)

  await db
    .delete(pendingCredentialDraft)
    .where(
      and(eq(pendingCredentialDraft.userId, userId), lt(pendingCredentialDraft.expiresAt, now))
    )

  await db
    .insert(pendingCredentialDraft)
    .values({
      id: generateId(),
      userId,
      workspaceId,
      providerId,
      displayName,
      expiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        pendingCredentialDraft.userId,
        pendingCredentialDraft.providerId,
        pendingCredentialDraft.workspaceId,
      ],
      set: { displayName, expiresAt, createdAt: now },
    })

  logger.info('Created OAuth connect credential draft', { userId, workspaceId, providerId })
}
