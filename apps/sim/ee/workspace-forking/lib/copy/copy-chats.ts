import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, inArray, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { isRecord } from '@/lib/workflows/persistence/remap-internal-ids'

const logger = createLogger('WorkspaceForkCopyChats')

/** Attempts at a random chat identifier before falling back to a long random suffix. */
const IDENTIFIER_ATTEMPTS = 5

export interface ForkChatCopyPair {
  sourceWorkflowId: string
  targetWorkflowId: string
  /** The target workflow's display name, for the generated chat identifier. */
  workflowName: string
}

/** Lowercase a display name into the chat identifier charset (`[a-z0-9-]`), bounded. */
function slugifyForIdentifier(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '')
  return slug || 'chat'
}

/**
 * `{workspace}-{workflow}-{randomnum}` in the identifier charset. Six digits: concurrent forks
 * of one parent share the workspace/workflow slugs and can't see each other's uncommitted rows,
 * so the number is the only collision guard across simultaneous transactions.
 */
function buildIdentifierCandidate(workspaceSlug: string, workflowName: string): string {
  const random = 100000 + Math.floor(Math.random() * 900000)
  return `${workspaceSlug}-${slugifyForIdentifier(workflowName)}-${random}`
}

/** Remap each output config's `blockId` onto the target workflow's block ids. */
function remapChatOutputConfigs(
  value: unknown,
  targetWorkflowId: string,
  resolveBlockId: (targetWorkflowId: string, sourceBlockId: string) => string
): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.blockId !== 'string') return entry
    return { ...entry, blockId: resolveBlockId(targetWorkflowId, entry.blockId) }
  })
}

/**
 * Carry chat deployments onto the target side of a fork or sync: each LIVE source chat whose
 * target workflow has NO chat row at all (live or archived) is copied with a freshly generated
 * identifier - `{target-workspace}-{workflow}-{randomnum}` - so the copy serves at its own URL
 * immediately once the workflow deploys. Config copies verbatim (title, customizations, auth
 * incl. the hashed password and allowed emails); `outputConfigs` block ids are remapped through
 * the SAME block-id resolver the workflow write used, so the outputs bind to the target's
 * blocks.
 *
 * Targets with ANY existing chat row are left completely untouched ("maintained"): an already
 * carried-over chat keeps its identifier and config on every subsequent sync, and a chat the
 * target side deliberately archived is never resurrected. Bounded by the synced workflow count;
 * identifiers are collision-checked against live chats and fall back to a long random suffix.
 */
export async function copyForkChatDeployments(params: {
  tx: DbOrTx
  pairs: ForkChatCopyPair[]
  /** The TARGET workspace's display name, the identifier's first segment. */
  targetWorkspaceName: string
  userId: string
  now: Date
  resolveBlockId: (targetWorkflowId: string, sourceBlockId: string) => string
  requestId?: string
}): Promise<{ created: number }> {
  const { tx, pairs, targetWorkspaceName, userId, now, resolveBlockId, requestId } = params
  if (pairs.length === 0) return { created: 0 }

  const pairBySource = new Map(pairs.map((pair) => [pair.sourceWorkflowId, pair]))
  const sourceChats = await tx
    .select()
    .from(chat)
    .where(and(inArray(chat.workflowId, [...pairBySource.keys()]), isNull(chat.archivedAt)))
  if (sourceChats.length === 0) return { created: 0 }

  // A target workflow with ANY chat row (live or archived) keeps it: live means the carry-over
  // already happened (or the target made its own); archived means the target deliberately
  // retired it - recreating would resurrect against their intent.
  const candidateTargetIds = [
    ...new Set(
      sourceChats
        .map((row) => pairBySource.get(row.workflowId)?.targetWorkflowId)
        .filter((id): id is string => Boolean(id))
    ),
  ]
  const existingTargetRows = await tx
    .select({ workflowId: chat.workflowId })
    .from(chat)
    .where(inArray(chat.workflowId, candidateTargetIds))
  const targetsWithChat = new Set(existingTargetRows.map((row) => row.workflowId))

  const toCopy = sourceChats.filter((row) => {
    const pair = pairBySource.get(row.workflowId)
    return pair && !targetsWithChat.has(pair.targetWorkflowId)
  })
  if (toCopy.length === 0) return { created: 0 }

  // Generate identifiers, retrying collisions against LIVE chats (the unique index is partial
  // on `archived_at IS NULL`, so archived identifiers are reusable) and against this batch.
  const workspaceSlug = slugifyForIdentifier(targetWorkspaceName)
  const identifierByChatId = new Map<string, string>()
  let pending = toCopy.map((row) => ({
    chatId: row.id,
    workflowName: pairBySource.get(row.workflowId)?.workflowName ?? 'chat',
  }))
  for (let attempt = 0; attempt < IDENTIFIER_ATTEMPTS && pending.length > 0; attempt++) {
    const claimed = new Set(identifierByChatId.values())
    const candidates = pending.map((entry) => {
      let candidate = buildIdentifierCandidate(workspaceSlug, entry.workflowName)
      while (claimed.has(candidate)) {
        candidate = buildIdentifierCandidate(workspaceSlug, entry.workflowName)
      }
      claimed.add(candidate)
      return { ...entry, candidate }
    })
    const taken = new Set(
      (
        await tx
          .select({ identifier: chat.identifier })
          .from(chat)
          .where(
            and(
              inArray(
                chat.identifier,
                candidates.map((entry) => entry.candidate)
              ),
              isNull(chat.archivedAt)
            )
          )
      ).map((row) => row.identifier)
    )
    pending = []
    for (const entry of candidates) {
      if (taken.has(entry.candidate)) pending.push(entry)
      else identifierByChatId.set(entry.chatId, entry.candidate)
    }
  }
  for (const entry of pending) {
    // Exhausted the friendly attempts: a long random suffix is effectively collision-free
    // (the global unique index still backstops it).
    identifierByChatId.set(
      entry.chatId,
      `${workspaceSlug}-${slugifyForIdentifier(entry.workflowName)}-${generateShortId(10)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '0')}`
    )
  }

  const inserts: (typeof chat.$inferInsert)[] = []
  for (const row of toCopy) {
    const pair = pairBySource.get(row.workflowId)
    const identifier = identifierByChatId.get(row.id)
    if (!pair || !identifier) continue
    inserts.push({
      ...row,
      id: generateId(),
      workflowId: pair.targetWorkflowId,
      userId,
      identifier,
      outputConfigs: remapChatOutputConfigs(
        row.outputConfigs,
        pair.targetWorkflowId,
        resolveBlockId
      ),
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
  }
  if (inserts.length > 0) {
    await tx.insert(chat).values(inserts)
    logger.info(`[${requestId ?? 'unknown'}] Carried ${inserts.length} chat deployment(s)`, {
      identifiers: inserts.map((row) => row.identifier),
    })
  }
  return { created: inserts.length }
}
