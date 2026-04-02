import { createLogger } from '@sim/logger'
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
  ashby: {
    emailType: '_removed_emailType',
    phoneType: '_removed_phoneType',
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
 * Maps old Rippling operation values to their current equivalents.
 *
 * When the integration was expanded from 16 to 86 tools, several
 * operations were renamed or removed. Saved workflows still carry
 * the old operation value. Without this mapping the tool selector
 * returns an unregistered tool ID, causing a runtime error.
 */
export const OPERATION_VALUE_MIGRATIONS: Record<string, Record<string, string>> = {
  rippling: {
    list_employees: 'list_workers',
    get_employee: 'get_worker',
    list_employees_with_terminated: 'list_workers',
    get_company: 'list_companies',
    get_company_activity: '_removed_get_company_activity',
    list_levels: '_removed_list_levels',
    list_leave_requests: '_removed_list_leave_requests',
    process_leave_request: '_removed_process_leave_request',
    list_leave_balances: '_removed_list_leave_balances',
    get_leave_balance: '_removed_get_leave_balance',
    list_leave_types: '_removed_list_leave_types',
    create_group: '_removed_create_group',
    update_group: '_removed_update_group',
    push_candidate: '_removed_push_candidate',
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
    const opMigrations = OPERATION_VALUE_MIGRATIONS[block.type]
    let currentBlock = block

    if (renames && block.subBlocks) {
      const { subBlocks, migrated } = migrateBlockSubblockIds(block.subBlocks, renames)
      if (migrated) {
        logger.info('Migrated legacy subblock IDs', {
          blockId: block.id,
          blockType: block.type,
        })
        anyMigrated = true
        currentBlock = { ...currentBlock, subBlocks }
      }
    }

    if (opMigrations && currentBlock.subBlocks?.operation) {
      const oldOp = String(currentBlock.subBlocks.operation.value ?? '')
      const newOp = opMigrations[oldOp]
      if (newOp) {
        logger.info('Migrated legacy operation value', {
          blockId: currentBlock.id,
          blockType: currentBlock.type,
          from: oldOp,
          to: newOp,
        })
        anyMigrated = true
        currentBlock = {
          ...currentBlock,
          subBlocks: {
            ...currentBlock.subBlocks,
            operation: { ...currentBlock.subBlocks.operation, value: newOp },
          },
        }
      }
    }

    result[blockId] = currentBlock
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
