import { createLogger } from '@sim/logger'
import { DEFAULT_SUBBLOCK_TYPE } from '@sim/workflow-persistence/subblocks'
import { isPlainRecord } from '@/lib/core/utils/records'
import { sanitizeMalformedSubBlocks } from '@/lib/workflows/sanitization/subblocks'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  isCanonicalPair,
  resolveCanonicalMode,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks'
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
  dynamodb: {
    key: 'getKey',
    filterExpression: 'queryFilterExpression',
    expressionAttributeNames: 'queryExpressionAttributeNames',
    expressionAttributeValues: 'queryExpressionAttributeValues',
    limit: 'queryLimit',
    conditionExpression: 'updateConditionExpression',
  },
  ashby: {
    emailType: '_removed_emailType',
    phoneType: '_removed_phoneType',
    expandApplicationFormDefinition: '_removed_expandApplicationFormDefinition',
    expandSurveyFormDefinitions: '_removed_expandSurveyFormDefinitions',
  },
  rippling: {
    action: '_removed_action',
    candidateDepartment: '_removed_candidateDepartment',
    candidatePhone: '_removed_candidatePhone',
    candidateStartDate: '_removed_candidateStartDate',
    email: '_removed_email',
    employeeId: '_removed_employeeId',
    endDate: '_removed_endDate',
    firstName: '_removed_firstName',
    groupId: '_removed_groupId',
    groupName: '_removed_groupName',
    groupVersion: '_removed_groupVersion',
    jobTitle: '_removed_jobTitle',
    lastName: '_removed_lastName',
    leaveRequestId: '_removed_leaveRequestId',
    managedBy: '_removed_managedBy',
    nextCursor: '_removed_nextCursor',
    offset: '_removed_offset',
    roleId: '_removed_roleId',
    spokeId: '_removed_spokeId',
    startDate: '_removed_startDate',
    status: '_removed_status',
    users: '_removed_users',
  },
}

/**
 * Migrates legacy subblock IDs inside a single block's subBlocks map.
 * Returns a new subBlocks record if anything changed, or the original if not.
 */
function migrateBlockSubblockIds(
  blockType: string,
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
  const blockConfig = getBlock(blockType)

  for (const [oldId, newId] of Object.entries(renames)) {
    if (!(oldId in result)) continue

    if (newId in result) {
      delete result[oldId]
      continue
    }

    const oldEntry: unknown = result[oldId]
    const configuredType = blockConfig?.subBlocks?.find((config) => config.id === newId)?.type
    if (isPlainRecord(oldEntry)) {
      const type =
        configuredType ||
        (typeof oldEntry.type === 'string' && oldEntry.type.length > 0
          ? oldEntry.type === 'unknown'
            ? DEFAULT_SUBBLOCK_TYPE
            : oldEntry.type
          : DEFAULT_SUBBLOCK_TYPE)
      const value = Object.hasOwn(oldEntry, 'value') ? oldEntry.value : null

      result[newId] = {
        ...oldEntry,
        id: newId,
        type: type as BlockState['subBlocks'][string]['type'],
        value: value as BlockState['subBlocks'][string]['value'],
      }
    } else {
      result[newId] = {
        id: newId,
        type: configuredType || DEFAULT_SUBBLOCK_TYPE,
        value: oldEntry as BlockState['subBlocks'][string]['value'],
      }
    }
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
    if (!block.subBlocks) {
      result[blockId] = block
      continue
    }

    const renames = SUBBLOCK_ID_MIGRATIONS[block.type]
    const renamed = renames
      ? migrateBlockSubblockIds(block.type, block.subBlocks, renames)
      : { subBlocks: block.subBlocks, migrated: false }
    const renamedBlock = renamed.migrated ? { ...block, subBlocks: renamed.subBlocks } : block
    const sanitized = sanitizeMalformedSubBlocks(renamedBlock)
    const blockMigrated = renamed.migrated || sanitized.changed

    if (blockMigrated) {
      if (renamed.migrated) {
        logger.info('Migrated legacy subblock IDs', {
          blockId: block.id,
          blockType: block.type,
        })
      }
      anyMigrated = true
      result[blockId] = { ...renamedBlock, subBlocks: sanitized.subBlocks }
    } else {
      result[blockId] = block
    }
  }

  return { blocks: result, migrated: anyMigrated }
}

/**
 * Backfills missing `canonicalModes` entries in block data.
 *
 * When a canonical pair is added to a block definition, existing blocks
 * won't have the entry in `data.canonicalModes`. Without it the editor
 * toggle may not render correctly. This resolves the correct mode based
 * on which subblock value is populated and adds the missing entry.
 */
export function backfillCanonicalModes(blocks: Record<string, BlockState>): {
  blocks: Record<string, BlockState>
  migrated: boolean
} {
  let anyMigrated = false
  const result: Record<string, BlockState> = {}

  for (const [blockId, block] of Object.entries(blocks)) {
    const blockConfig = getBlock(block.type)
    if (!blockConfig?.subBlocks || !block.subBlocks) {
      result[blockId] = block
      continue
    }

    const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks)
    const pairs = Object.values(canonicalIndex.groupsById).filter(isCanonicalPair)
    if (pairs.length === 0) {
      result[blockId] = block
      continue
    }

    const existing = (block.data?.canonicalModes ?? {}) as Record<string, 'basic' | 'advanced'>
    let patched: Record<string, 'basic' | 'advanced'> | null = null

    const values = buildSubBlockValues(block.subBlocks)

    for (const group of pairs) {
      if (existing[group.canonicalId] != null) continue

      const resolved = resolveCanonicalMode(group, values)
      if (!patched) patched = { ...existing }
      patched[group.canonicalId] = resolved
    }

    if (patched) {
      anyMigrated = true
      result[blockId] = {
        ...block,
        data: { ...(block.data ?? {}), canonicalModes: patched },
      }
    } else {
      result[blockId] = block
    }
  }

  return { blocks: result, migrated: anyMigrated }
}
