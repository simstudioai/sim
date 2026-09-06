import { db } from '@sim/db'
import { apiKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { and, eq, gt, sql } from 'drizzle-orm'
import { createApiKey } from '@/lib/api-key/auth'
import { decryptApiKey, hashApiKey } from '@/lib/api-key/crypto'

const logger = createLogger('MothershipDelegation')

const DELEGATION_TTL_MS = 12 * 60 * 60 * 1000
const MIN_REMAINING_MS = 30 * 60 * 1000

function delegationName(userId: string): string {
  return `mothership-delegation:${userId}`
}

/**
 * Mints (or reuses) the user credential the embedded and workbench CLIs present on v2 calls
 * (revamp D23). One rolling PERSONAL key per user — "the agent is the user" (D25): personal
 * keys carry exactly the user's own authorization on every v2 operation, where workspace
 * keys are op-restricted (graph edits return WORKSPACE_KEY_OPERATION_NOT_PERMITTED).
 * Server-minted, 12h TTL enforced by the normal API-key auth path — the worker holds no
 * standing credentials and the token never outlives its TTL. Rotation is atomic per user
 * across server instances; parallel first callers reuse the same key. Returns null on
 * failure so callers can report unavailable authentication without attempting the command.
 */
export async function mintDelegationToken(params: {
  workspaceId: string
  userId: string
}): Promise<string | null> {
  try {
    return await db.transaction(async (tx) => {
      const name = delegationName(params.userId)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`)
      const [existing] = await tx
        .select({ id: apiKey.id, key: apiKey.key, expiresAt: apiKey.expiresAt })
        .from(apiKey)
        .where(
          and(
            eq(apiKey.userId, params.userId),
            eq(apiKey.name, name),
            eq(apiKey.type, 'personal'),
            gt(apiKey.expiresAt, new Date(Date.now() + MIN_REMAINING_MS))
          )
        )
        .limit(1)
      if (existing) {
        const { decrypted } = await decryptApiKey(existing.key)
        return decrypted
      }

      const { key: plainKey, encryptedKey } = await createApiKey(true)
      const stored = encryptedKey ?? plainKey
      const now = new Date()
      const expiresAt = new Date(now.getTime() + DELEGATION_TTL_MS)
      await tx
        .delete(apiKey)
        .where(
          and(eq(apiKey.userId, params.userId), eq(apiKey.name, name), eq(apiKey.type, 'personal'))
        )
      await tx.insert(apiKey).values({
        id: generateShortId(),
        userId: params.userId,
        createdBy: params.userId,
        name,
        key: stored,
        keyHash: hashApiKey(plainKey),
        type: 'personal',
        createdAt: now,
        updatedAt: now,
        expiresAt,
      })
      return plainKey
    })
  } catch (error) {
    // Database errors can include bound credential values in their message and params.
    logger.warn('Delegation token minting failed; chat continues without one', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    })
    return null
  }
}
