import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { DEFAULT_SUBBLOCK_TYPE } from '@sim/workflow-persistence/subblocks'
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
 * Marks a migration target as "this field is gone", rather than a rename. The
 * old value is discarded instead of being carried into workflow state.
 */
const REMOVED_SUBBLOCK_ID_PREFIX = '_removed_'

/**
 * Maps old subblock IDs to their current equivalents per block type.
 *
 * When a subblock is renamed in a block definition, old deployed/saved states
 * still carry the value under the previous key. Without this mapping the
 * serializer silently drops the value, breaking execution.
 *
 * Format: { blockType: { oldSubblockId: newSubblockId } }
 *
 * A target prefixed with `_removed_` means the field was deleted outright; the
 * stored value is dropped. Use it for fields with no replacement — never map a
 * secret onto a live subblock.
 */
export const SUBBLOCK_ID_MIGRATIONS: Record<string, Record<string, string>> = {
  instagram: {
    metrics: 'insightMetrics',
  },
  knowledge: {
    knowledgeBaseId: 'knowledgeBaseSelector',
  },
  algolia: {
    listPage: 'page',
    listHitsPerPage: 'hitsPerPage',
  },
  kalshi: {
    settlementStatus: '_removed_settlementStatus',
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
    filterCandidateId: '_removed_filterCandidateId',
  },
  clickup: {
    workspaceId: 'workspaceSelector',
    spaceId: 'spaceSelector',
    listSpaceId: 'listSpaceSelector',
    folderId: 'folderSelector',
    listId: 'listSelector',
  },
  apollo: {
    contact_ids_bulk: 'contacts',
    account_ids_bulk: 'accounts',
    close_date: 'closed_date',
    stage_id: 'opportunity_stage_id',
    note: 'task_notes',
    description: '_removed_description',
    stage_ids: '_removed_stage_ids',
    owner_ids: '_removed_owner_ids',
  },
  exa: {
    /**
     * Exa deprecated both fields. `useAutoprompt` is gone from the API, and
     * `livecrawl` is superseded by `maxAgeHours` — but their values are not
     * interchangeable (`livecrawl` is a mode string, `maxAgeHours` a number),
     * so mapping one onto the other would send `NaN`. Dropping `livecrawl` is
     * also the fix for the block having defaulted it to `never`, which pinned
     * every saved search to cached results.
     */
    useAutoprompt: '_removed_useAutoprompt',
    livecrawl: '_removed_livecrawl',
  },
  /**
   * The Snowflake block moved from per-block `host` + `apiKey` fields to a
   * stored credential, and gave every object field a basic picker paired with
   * an advanced text input.
   *
   * The old free-text values map onto the ADVANCED members, not the pickers: a
   * migrated block has no credential yet, so a picker cannot hydrate a name and
   * would render an empty control over a non-empty value. `fileFormat` is the
   * clearest case — legacy values were fully qualified (`DB.SCHEMA.FORMAT`)
   * while the picker lists bare names, so it could never resolve. The host and
   * token have no in-block equivalent and are dropped.
   */
  snowflake: {
    database: 'databaseName',
    schema: 'schemaName',
    table: 'tableName',
    fileFormat: 'fileFormatName',
    warehouseName: 'warehouseNameManual',
    procedureName: 'procedureNameManual',
    warehouse: 'warehouseManual',
    role: 'roleManual',
    host: '_removed_host',
    apiKey: '_removed_apiKey',
  },
  /**
   * NetSuite moved certificate credentials out of workflow state and into one
   * reusable service-account credential. Selector-backed free-text entity
   * identifiers map to the advanced members of their new selector pairs;
   * dataset IDs remain direct text inputs and therefore keep their existing
   * key. Long-lived signing material has no in-block replacement and must be
   * discarded so it cannot survive under an unreachable subblock key.
   */
  netsuite: {
    recordType: 'recordTypeManual',
    statusTaskId: 'statusTaskIdManual',
    resultTaskId: 'resultTaskIdManual',
    taskId: 'resultTaskIdManual',
    accountId: '_removed_accountId',
    suiteTalkUrl: '_removed_suiteTalkUrl',
    clientId: '_removed_clientId',
    certificateId: '_removed_certificateId',
    privateKey: '_removed_privateKey',
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

const NETSUITE_DATASET_CANONICAL_ID = 'datasetId'
const NETSUITE_DATASET_BASIC_ID = 'datasetSelector'
const NETSUITE_DATASET_ADVANCED_ID = 'datasetIdManual'
const NETSUITE_DATASET_GROUP = {
  canonicalId: NETSUITE_DATASET_CANONICAL_ID,
  basicId: NETSUITE_DATASET_BASIC_ID,
  advancedIds: [NETSUITE_DATASET_ADVANCED_ID],
}

type CanonicalMode = 'basic' | 'advanced'

function readCanonicalMode(value: unknown): CanonicalMode | undefined {
  return value === 'basic' || value === 'advanced' ? value : undefined
}

/**
 * Selects the live member of the short-lived NetSuite dataset selector pair.
 * Explicit modes are strict: a null active value stays null and never falls
 * back to a stale dormant member. Without a saved mode, a lone member wins;
 * when both exist, use the same value heuristic as canonical serialization.
 */
function selectLegacyDatasetMember(
  values: Record<string, unknown>,
  mode: CanonicalMode | undefined
): string | undefined {
  const hasBasic = Object.hasOwn(values, NETSUITE_DATASET_BASIC_ID)
  const hasAdvanced = Object.hasOwn(values, NETSUITE_DATASET_ADVANCED_ID)
  if (!hasBasic && !hasAdvanced) return undefined

  if (mode === 'basic') return hasBasic ? NETSUITE_DATASET_BASIC_ID : undefined
  if (mode === 'advanced') return hasAdvanced ? NETSUITE_DATASET_ADVANCED_ID : undefined
  if (hasBasic !== hasAdvanced) {
    return hasBasic ? NETSUITE_DATASET_BASIC_ID : NETSUITE_DATASET_ADVANCED_ID
  }

  return resolveCanonicalMode(NETSUITE_DATASET_GROUP, values) === 'advanced'
    ? NETSUITE_DATASET_ADVANCED_ID
    : NETSUITE_DATASET_BASIC_ID
}

function makeMigratedSubblock(
  blockType: string,
  source: unknown,
  targetId: string
): BlockState['subBlocks'][string] {
  const configuredType = getBlock(blockType)?.subBlocks?.find(
    (config) => config.id === targetId
  )?.type
  if (isPlainRecord(source)) {
    const type =
      configuredType ||
      (typeof source.type === 'string' && source.type.length > 0
        ? source.type === 'unknown'
          ? DEFAULT_SUBBLOCK_TYPE
          : source.type
        : DEFAULT_SUBBLOCK_TYPE)
    const value = Object.hasOwn(source, 'value') ? source.value : null

    return {
      ...source,
      id: targetId,
      type: type as BlockState['subBlocks'][string]['type'],
      value: value as BlockState['subBlocks'][string]['value'],
    }
  }

  return {
    id: targetId,
    type: configuredType || DEFAULT_SUBBLOCK_TYPE,
    value: source as BlockState['subBlocks'][string]['value'],
  }
}

/** Collapses the removed dataset picker on a top-level NetSuite block. */
function migrateNetSuiteDatasetSubblocks(block: BlockState): {
  block: BlockState
  migrated: boolean
} {
  const values = buildSubBlockValues(block.subBlocks)
  const modes = block.data?.canonicalModes
  const sourceId = selectLegacyDatasetMember(
    values,
    readCanonicalMode(modes?.[NETSUITE_DATASET_CANONICAL_ID])
  )
  const hasLegacyMember =
    Object.hasOwn(block.subBlocks, NETSUITE_DATASET_BASIC_ID) ||
    Object.hasOwn(block.subBlocks, NETSUITE_DATASET_ADVANCED_ID)
  const hasLegacyMode = Boolean(modes && Object.hasOwn(modes, NETSUITE_DATASET_CANONICAL_ID))
  if (!hasLegacyMember && !hasLegacyMode) return { block, migrated: false }

  const subBlocks = { ...block.subBlocks }
  if (!Object.hasOwn(subBlocks, NETSUITE_DATASET_CANONICAL_ID) && sourceId) {
    subBlocks[NETSUITE_DATASET_CANONICAL_ID] = makeMigratedSubblock(
      block.type,
      subBlocks[sourceId],
      NETSUITE_DATASET_CANONICAL_ID
    )
  }
  delete subBlocks[NETSUITE_DATASET_BASIC_ID]
  delete subBlocks[NETSUITE_DATASET_ADVANCED_ID]

  let data = block.data
  if (hasLegacyMode && modes) {
    const canonicalModes = { ...modes }
    delete canonicalModes[NETSUITE_DATASET_CANONICAL_ID]
    data = { ...(block.data ?? {}), canonicalModes }
  }

  return { block: { ...block, subBlocks, data }, migrated: true }
}

function migrateNetSuiteAgentParams(
  params: Record<string, unknown>,
  datasetMode: CanonicalMode | undefined
): { params: Record<string, unknown>; migrated: boolean } {
  let migrated = false
  const result = { ...params }

  for (const [oldId, newId] of Object.entries(SUBBLOCK_ID_MIGRATIONS.netsuite)) {
    if (!Object.hasOwn(result, oldId)) continue
    if (!newId.startsWith(REMOVED_SUBBLOCK_ID_PREFIX) && !Object.hasOwn(result, newId)) {
      result[newId] = result[oldId]
    }
    delete result[oldId]
    migrated = true
  }

  const sourceId = selectLegacyDatasetMember(result, datasetMode)
  const hasLegacyDataset =
    Object.hasOwn(result, NETSUITE_DATASET_BASIC_ID) ||
    Object.hasOwn(result, NETSUITE_DATASET_ADVANCED_ID)
  if (hasLegacyDataset) {
    if (!Object.hasOwn(result, NETSUITE_DATASET_CANONICAL_ID) && sourceId) {
      result[NETSUITE_DATASET_CANONICAL_ID] = result[sourceId]
    }
    delete result[NETSUITE_DATASET_BASIC_ID]
    delete result[NETSUITE_DATASET_ADVANCED_ID]
    migrated = true
  }

  return { params: result, migrated }
}

/**
 * Agent tools persist block parameters inside the Agent's `tools` subblock, so
 * top-level block migrations never see them. Migrate NetSuite entries in place
 * by tool index, which is also how their canonical-mode overrides are scoped.
 */
function migrateAgentNetSuiteTools(block: BlockState): {
  block: BlockState
  migrated: boolean
} {
  const toolsSubblock = block.subBlocks.tools
  const storedTools: unknown = toolsSubblock?.value
  if (!isPlainRecord(toolsSubblock) || !Array.isArray(storedTools)) {
    return { block, migrated: false }
  }
  const toolEntries = storedTools as unknown[]

  const modes = block.data?.canonicalModes
  let canonicalModes: Record<string, CanonicalMode> | undefined
  let tools: unknown[] | undefined
  let migrated = false

  toolEntries.forEach((entry, toolIndex) => {
    if (!isPlainRecord(entry) || entry.type !== 'netsuite') return

    const scopedModeKey = `${toolIndex}:${NETSUITE_DATASET_CANONICAL_ID}`
    const scopedMode = readCanonicalMode(modes?.[scopedModeKey])
    const legacyMode = readCanonicalMode(modes?.[`netsuite:${NETSUITE_DATASET_CANONICAL_ID}`])
    const rawParams = isPlainRecord(entry.params) ? entry.params : undefined
    const migratedParams = rawParams
      ? migrateNetSuiteAgentParams(rawParams, scopedMode ?? legacyMode)
      : { params: rawParams, migrated: false }

    if (migratedParams.migrated) {
      tools ??= [...toolEntries]
      tools[toolIndex] = { ...entry, params: migratedParams.params }
      migrated = true
    }

    if (modes && Object.hasOwn(modes, scopedModeKey)) {
      canonicalModes ??= { ...modes }
      delete canonicalModes[scopedModeKey]
      migrated = true
    }
  })

  const legacyModeKey = `netsuite:${NETSUITE_DATASET_CANONICAL_ID}`
  if (modes && Object.hasOwn(modes, legacyModeKey)) {
    canonicalModes ??= { ...modes }
    delete canonicalModes[legacyModeKey]
    migrated = true
  }

  if (!migrated) return { block, migrated: false }

  let subBlocks = block.subBlocks
  if (tools) {
    const migratedToolsSubblock = { ...toolsSubblock }
    // Tool-input values are arrays even though SubBlockState.value is typed narrowly.
    const toolsValueTarget: { value: unknown } = migratedToolsSubblock
    toolsValueTarget.value = tools
    subBlocks = { ...block.subBlocks, tools: migratedToolsSubblock }
  }

  return {
    block: {
      ...block,
      subBlocks,
      data: canonicalModes ? { ...(block.data ?? {}), canonicalModes } : block.data,
    },
    migrated: true,
  }
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

  for (const [oldId, newId] of Object.entries(renames)) {
    if (!(oldId in result)) continue

    // A `_removed_` target means the field no longer exists in the block. Drop
    // the value rather than parking it under a dead key: nothing ever reads
    // these keys, and secret scrubbing walks the block config, so a parked
    // `password: true` value would never be cleared and would ride along in
    // workflow exports and templates.
    if (newId.startsWith(REMOVED_SUBBLOCK_ID_PREFIX)) {
      delete result[oldId]
      continue
    }

    if (newId in result) {
      delete result[oldId]
      continue
    }

    result[newId] = makeMigratedSubblock(blockType, result[oldId], newId)
    delete result[oldId]
  }

  return { subBlocks: result, migrated: true }
}

/**
 * Drops any `_removed_*` subblock left behind by an earlier version of this
 * migration, which renamed retired fields into a dead key instead of deleting
 * them. Those keys are unreachable from the block config, so secret scrubbing —
 * which walks the config — can never clear them, and a parked token or PII
 * would otherwise survive in state, exports, and templates indefinitely.
 *
 * Runs for every block, not just those with a rename map: the parked keys no
 * longer appear in any `SUBBLOCK_ID_MIGRATIONS` entry as an `oldId`, so nothing
 * else would ever look at them.
 */
function dropParkedSubblocks(subBlocks: Record<string, BlockState['subBlocks'][string]>): {
  subBlocks: Record<string, BlockState['subBlocks'][string]>
  dropped: boolean
} {
  const parked = Object.keys(subBlocks).filter((id) => id.startsWith(REMOVED_SUBBLOCK_ID_PREFIX))
  if (parked.length === 0) return { subBlocks, dropped: false }

  const result = { ...subBlocks }
  for (const id of parked) delete result[id]
  return { subBlocks: result, dropped: true }
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

    const netSuiteDataset =
      block.type === 'netsuite'
        ? migrateNetSuiteDatasetSubblocks(block)
        : { block, migrated: false }
    const agentTools =
      netSuiteDataset.block.type === 'agent'
        ? migrateAgentNetSuiteTools(netSuiteDataset.block)
        : { block: netSuiteDataset.block, migrated: false }
    const workingBlock = agentTools.block

    const renames = SUBBLOCK_ID_MIGRATIONS[workingBlock.type]
    const renamed = renames
      ? migrateBlockSubblockIds(workingBlock.type, workingBlock.subBlocks, renames)
      : { subBlocks: workingBlock.subBlocks, migrated: false }
    const purged = dropParkedSubblocks(renamed.subBlocks)
    const changedSubBlocks = renamed.migrated || purged.dropped
    const renamedBlock = changedSubBlocks
      ? { ...workingBlock, subBlocks: purged.subBlocks }
      : workingBlock
    const sanitized = sanitizeMalformedSubBlocks(renamedBlock)
    const blockMigrated =
      netSuiteDataset.migrated || agentTools.migrated || changedSubBlocks || sanitized.changed

    if (blockMigrated) {
      if (purged.dropped) {
        logger.info('Dropped parked subblock values left by an earlier migration', {
          blockId: block.id,
          blockType: block.type,
        })
      }
      if (renamed.migrated) {
        logger.info('Migrated legacy subblock IDs', {
          blockId: block.id,
          blockType: block.type,
        })
      }
      if (netSuiteDataset.migrated || agentTools.migrated) {
        logger.info('Migrated legacy NetSuite workflow state', {
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
