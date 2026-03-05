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
 * Returns a new subBlocks record if anything changed, or the original if not.
 */
function migrateBlockSubblockIds(
  subBlocks: Record<string, BlockState['subBlocks'][string]>,
  renames: Record<string, string>
): { subBlocks: Record<string, BlockState['subBlocks'][string]>; migrated: boolean } {
  let migrated = false

  for (const oldId of Object.keys(renames)) {
    if (oldId in subBlocks) {
      migrated = true
      break
    }
  }

  if (!migrated) return { subBlocks, migrated: false }

  const result = { ...subBlocks }

  for (const [oldId, newId] of Object.entries(renames)) {
    if (!(oldId in result)) continue

    if (newId in result) {
      delete result[oldId]
      continue
    }

    const oldEntry = result[oldId]
    result[newId] = { ...oldEntry, id: newId }
    delete result[oldId]
  }

  return { subBlocks: result, migrated: true }
}

/**
 * Applies subblock-ID migrations to every block in a workflow.
 * Returns a new blocks record with migrated subBlocks where needed.
 */
export function migrateSubblockIds(blocks: Record<string, BlockState>): {
  blocks: Record<string, BlockState>
  migrated: boolean
} {
  let anyMigrated = false
  const result: Record<string, BlockState> = {}

  for (const [blockId, block] of Object.entries(blocks)) {
    const renames = SUBBLOCK_ID_MIGRATIONS[block.type]
    if (!renames || !block.subBlocks) {
      result[blockId] = block
      continue
    }

    const { subBlocks, migrated } = migrateBlockSubblockIds(block.subBlocks, renames)
    if (migrated) {
      logger.info('Migrated legacy subblock IDs', {
        blockId: block.id,
        blockType: block.type,
      })
      anyMigrated = true
      result[blockId] = { ...block, subBlocks }
    } else {
      result[blockId] = block
    }
  }

  return { blocks: result, migrated: anyMigrated }
}
