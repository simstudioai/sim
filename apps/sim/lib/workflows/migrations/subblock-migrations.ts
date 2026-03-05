import { createLogger } from '@sim/logger'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('SubblockMigrations')

/**
 * Maps old subblock IDs to their current equivalents per block type.
 *
 * When a subblock is renamed in a block definition, old deployed/saved states
 * still carry the value under the previous key. Without this mapping the
 * serializer silently drops the value, breaking execution.
 *
 * Format: { blockType: { oldSubblockId: newSubblockId } }
 */
export const SUBBLOCK_ID_MIGRATIONS: Record<string, Record<string, string>> = {
  knowledge: {
    knowledgeBaseId: 'knowledgeBaseSelector',
  },
}

/**
 * Migrates legacy subblock IDs inside a single block's subBlocks map.
 * If an old key is found and the new key does not already exist, the entry
 * is moved to the new key. When both exist the new key wins (user already
 * re-saved) and the old entry is removed to avoid orphans.
 *
 * Returns true if any migration was applied.
 */
function migrateBlockSubblockIds(block: BlockState, renames: Record<string, string>): boolean {
  const subBlocks = block.subBlocks
  if (!subBlocks) return false

  let migrated = false

  for (const [oldId, newId] of Object.entries(renames)) {
    if (!(oldId in subBlocks)) continue

    if (newId in subBlocks) {
      delete subBlocks[oldId]
      migrated = true
      continue
    }

    const oldEntry = subBlocks[oldId]
    subBlocks[newId] = { ...oldEntry, id: newId }
    delete subBlocks[oldId]
    migrated = true
  }

  return migrated
}

/**
 * Applies subblock-ID migrations to every block in a workflow.
 * Safe to call on any state – blocks whose type has no registered
 * migrations are left untouched.
 *
 * Mutates `blocks` in place and returns whether anything changed.
 */
export function migrateSubblockIds(blocks: Record<string, BlockState>): boolean {
  let anyMigrated = false

  for (const block of Object.values(blocks)) {
    const renames = SUBBLOCK_ID_MIGRATIONS[block.type]
    if (!renames) continue

    if (migrateBlockSubblockIds(block, renames)) {
      logger.info('Migrated legacy subblock IDs', {
        blockId: block.id,
        blockType: block.type,
      })
      anyMigrated = true
    }
  }

  return anyMigrated
}
