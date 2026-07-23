import { db } from '@sim/db'
import { credential, pendingCredentialDraft, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, lt } from 'drizzle-orm'
import { defaultCredentialDisplayName } from '@/lib/credentials/display-name'
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
  /** Reconnect only: the existing credential the callback should rebind instead of creating a new one. */
  credentialId?: string
  /** Reconnect only: the credential's actual name, so audit records stay accurate. */
  displayName?: string
}): Promise<void> {
  const { userId, workspaceId, providerId, credentialId } = params

  let displayName = params.displayName
  if (!displayName) {
    const service = getAllOAuthServices().find((s) => s.providerId === providerId)
    const serviceName = service?.name ?? providerId

    let userName: string | null = null
    try {
      const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId))
      userName = row?.name ?? null
    } catch (error) {
      // Cosmetic only — fall back to the "My {Service}" default
      logger.warn('User name lookup failed for connect draft display name', {
        userId,
        workspaceId,
        providerId,
        error,
      })
    }

    // Auto-number against existing workspace credentials so repeat connects for
    // the same provider stay distinguishable — same behavior as the connect
    // modal, which computes this client-side. Best effort: on failure the name
    // simply skips deduplication.
    let takenNames: ReadonlySet<string> = new Set<string>()
    try {
      const rows = await db
        .select({ displayName: credential.displayName })
        .from(credential)
        .where(and(eq(credential.workspaceId, workspaceId), eq(credential.type, 'oauth')))
      takenNames = new Set(rows.map((row) => row.displayName.toLowerCase()))
    } catch (error) {
      // Cosmetic only — proceed without collision numbering
      logger.warn('Credential name lookup failed for connect draft deduplication', {
        userId,
        workspaceId,
        providerId,
        error,
      })
    }

    displayName = defaultCredentialDisplayName(userName, serviceName, takenNames)
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
      credentialId: credentialId ?? null,
      expiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        pendingCredentialDraft.userId,
        pendingCredentialDraft.providerId,
        pendingCredentialDraft.workspaceId,
      ],
      // credentialId must be written on BOTH paths: a plain connect that reuses a
      // stale reconnect draft row would otherwise silently rebind the old
      // credential instead of creating a new one.
      set: { displayName, credentialId: credentialId ?? null, expiresAt, createdAt: now },
    })

  logger.info('Created OAuth connect credential draft', {
    userId,
    workspaceId,
    providerId,
    credentialId: credentialId ?? null,
  })
}
