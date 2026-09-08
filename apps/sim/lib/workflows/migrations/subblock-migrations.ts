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
 * One legacy-to-current subblock ID mapping for a block type.
 *
 * `whenOperation` scopes the rename to the operations the old ID belonged to.
 * Leave it off for an unconditional rename — the shape every entry predating
 * operation scoping uses.
 *
 * Scoping is required whenever the old ID is still a LIVE control for some
 * other operation on the same block. Cloudflare `type` is the
 * `list_dns_records` filter, `tags` the `purge_cache` list, `order`/`status`
 * the `list_zones` filters; ServiceNow `fields` is the Create/Update Record
 * JSON body — a different value space entirely; Okta `sendEmail` is the
 * activation/reset switch. An unconditional rename would move a value out of
 * the field that still owns it.
 */
export interface SubblockIdMigration {
  /** The subblock ID a legacy saved state stores the value under. */
  from: string
  /**
   * The current subblock ID, or a `_removed_`-prefixed name meaning the field
   * was deleted outright and the stored value should be dropped.
   */
  to: string
  /**
   * Apply only when the block's stored `operation` value is one of these.
   * Omit for an unconditional rename.
   */
  whenOperation?: readonly string[]
  /**
   * Apply only when the stored value passes this check. Needed when the legacy
   * ID served two incompatible value spaces that the stored `operation` alone
   * cannot separate, because a value written under one operation survives a
   * switch to another: subblock values are keyed by ID and are never cleared
   * when the operation changes.
   */
  whenValue?: (value: unknown) => boolean
}

/**
 * Whether a stored value could plausibly be a comma-separated field
 * projection rather than a JSON body.
 *
 * The shipped ServiceNow block declared `fields` three times — the Create and
 * Update Record JSON bodies and the Read Records projection — so one stored
 * value served both spaces. A block configured for Create Record and later
 * switched to Read Records without clearing the field carries the JSON body
 * under `fields` while `operation` already reads `servicenow_read_record`, so
 * the operation scope alone cannot tell a projection from a body. Promoting a
 * body onto `readFields` would send it as `sysparm_fields`, which is exactly
 * the cross-space leak the rename closed.
 *
 * The test is a positive allowlist, not a check for body-shaped input, because
 * a body is only reliably recognisable when it is well formed. A saved body can
 * be a half-typed draft (`{"short_description": `) or carry an unquoted
 * `<block.output>` reference, so neither "opens with a brace" nor "fails to
 * parse as JSON" identifies one: the first misses a bare scalar body like
 * `true`, the second misses both of those. Migrating one would move it to
 * `readFields` AND drop the original key, losing the draft.
 *
 * A projection is a comma-separated list of ServiceNow field names, which are
 * word characters plus the dot of a dotted walk. Anything carrying a brace,
 * quote, colon, angle bracket or interior space fails that shape. `JSON.parse`
 * then removes the bare scalars (`true`, `42`, `null`) that satisfy it by
 * accident. Ambiguity resolves to "not a projection", leaving the value on
 * `fields` where the Create/Update control still owns it.
 */
const SERVICENOW_FIELD_LIST = /^[A-Za-z0-9_.]+(?:\s*,\s*[A-Za-z0-9_.]+)*$/

function isFieldProjection(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!SERVICENOW_FIELD_LIST.test(trimmed)) return false
  try {
    JSON.parse(trimmed)
    return false
  } catch {
    return true
  }
}

/**
 * Maps old subblock IDs to their current equivalents per block type.
 *
 * When a subblock is renamed in a block definition, old deployed/saved states
 * still carry the value under the previous key. Without this mapping the
 * serializer silently drops the value, breaking execution.
 *
 * A `to` prefixed with `_removed_` means the field was deleted outright; the
 * stored value is dropped. Use it for fields with no replacement — never map a
 * secret onto a live subblock.
 */
export const SUBBLOCK_ID_MIGRATIONS: Record<string, readonly SubblockIdMigration[]> = {
  /** List Channels now returns one page and a cursor; automatic page limits are retired. */
  slack: [{ from: 'channelMaxPages', to: '_removed_channelMaxPages' }],
  slack_v2: [{ from: 'channelMaxPages', to: '_removed_channelMaxPages' }],
  instagram: [{ from: 'metrics', to: 'insightMetrics' }],
  knowledge: [{ from: 'knowledgeBaseId', to: 'knowledgeBaseSelector' }],
  /** Connected accounts resolve from the workspace; group selectors have no replacement. */
  credential_group: [
    { from: 'credentialGroup', to: '_removed_credentialGroup' },
    { from: 'manualCredentialGroup', to: '_removed_manualCredentialGroup' },
  ],
  algolia: [
    { from: 'listPage', to: 'page' },
    { from: 'listHitsPerPage', to: 'hitsPerPage' },
  ],
  kalshi: [{ from: 'settlementStatus', to: '_removed_settlementStatus' }],
  dynamodb: [
    { from: 'key', to: 'getKey' },
    { from: 'filterExpression', to: 'queryFilterExpression' },
    { from: 'expressionAttributeNames', to: 'queryExpressionAttributeNames' },
    { from: 'expressionAttributeValues', to: 'queryExpressionAttributeValues' },
    { from: 'limit', to: 'queryLimit' },
    { from: 'conditionExpression', to: 'updateConditionExpression' },
  ],
  ashby: [
    { from: 'emailType', to: '_removed_emailType' },
    { from: 'phoneType', to: '_removed_phoneType' },
    { from: 'expandApplicationFormDefinition', to: '_removed_expandApplicationFormDefinition' },
    { from: 'expandSurveyFormDefinitions', to: '_removed_expandSurveyFormDefinitions' },
    { from: 'filterCandidateId', to: '_removed_filterCandidateId' },
  ],
  clickup: [
    { from: 'workspaceId', to: 'workspaceSelector' },
    { from: 'spaceId', to: 'spaceSelector' },
    { from: 'listSpaceId', to: 'listSpaceSelector' },
    { from: 'folderId', to: 'folderSelector' },
    { from: 'listId', to: 'listSelector' },
  ],
  confluence_v2: [
    {
      from: 'spaceSelector',
      to: 'spaceKeySelector',
      whenOperation: ['search_in_space'],
    },
    { from: 'spaceId', to: 'manualSpaceKey', whenOperation: ['search_in_space'] },
  ],
  apollo: [
    { from: 'contact_ids_bulk', to: 'contacts' },
    { from: 'account_ids_bulk', to: 'accounts' },
    { from: 'close_date', to: 'closed_date' },
    { from: 'stage_id', to: 'opportunity_stage_id' },
    { from: 'note', to: 'task_notes' },
    { from: 'description', to: '_removed_description' },
    { from: 'stage_ids', to: '_removed_stage_ids' },
    { from: 'owner_ids', to: '_removed_owner_ids' },
  ],
  /**
   * Exa deprecated both fields. `useAutoprompt` is gone from the API, and
   * `livecrawl` is superseded by `maxAgeHours` — but their values are not
   * interchangeable (`livecrawl` is a mode string, `maxAgeHours` a number),
   * so mapping one onto the other would send `NaN`. Dropping `livecrawl` is
   * also the fix for the block having defaulted it to `never`, which pinned
   * every saved search to cached results.
   */
  exa: [
    { from: 'useAutoprompt', to: '_removed_useAutoprompt' },
    { from: 'livecrawl', to: '_removed_livecrawl' },
  ],
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
  snowflake: [
    { from: 'database', to: 'databaseName' },
    { from: 'schema', to: 'schemaName' },
    { from: 'table', to: 'tableName' },
    { from: 'fileFormat', to: 'fileFormatName' },
    { from: 'warehouseName', to: 'warehouseNameManual' },
    { from: 'procedureName', to: 'procedureNameManual' },
    { from: 'warehouse', to: 'warehouseManual' },
    { from: 'role', to: 'roleManual' },
    { from: 'host', to: '_removed_host' },
    { from: 'apiKey', to: '_removed_apiKey' },
  ],
  /**
   * Two unrelated Cloudflare changes land here.
   *
   * The `_removed_` entries: #6740 briefly gave the DNS/zone read filters and
   * the cache-purge tag list operation-suffixed IDs, and added a single shared
   * `cursor`. A later change restored the shipped filter IDs and split the
   * cursor per endpoint. Those suffixed IDs existed only between #6740 and that
   * change and never appeared in a release, so no saved workflow carries a
   * value worth recovering; they are dropped rather than renamed so nothing
   * stays parked in state and rides along in exports.
   *
   * The scoped entries: #6740 also renamed the DNS write controls off the bare
   * IDs the SHIPPED block stored them under. Before it, one `type` control
   * served `list_dns_records`, `create_dns_record`, AND `update_dns_record` —
   * a single stored value for all three, which is exactly the ambiguity the
   * rename removed. Every affected ID stayed live for the read filter, so each
   * rename is scoped to the operation that owned the written value. Without
   * these, a saved proxied A record is recreated UNPROXIED — publishing the
   * origin IP and bypassing the WAF/CDN — and `update_dns_record` silently
   * becomes a no-op.
   */
  cloudflare: [
    { from: 'zoneNameFilter', to: '_removed_zoneNameFilter' },
    { from: 'dnsNameFilter', to: '_removed_dnsNameFilter' },
    { from: 'dnsTypeFilter', to: '_removed_dnsTypeFilter' },
    { from: 'dnsContentFilter', to: '_removed_dnsContentFilter' },
    { from: 'dnsProxiedFilter', to: '_removed_dnsProxiedFilter' },
    { from: 'purgeTags', to: '_removed_purgeTags' },
    { from: 'cursor', to: '_removed_cursor' },
    { from: 'type', to: 'recordType', whenOperation: ['create_dns_record'] },
    { from: 'proxied', to: 'recordProxied', whenOperation: ['create_dns_record'] },
    { from: 'tags', to: 'recordTags', whenOperation: ['create_dns_record'] },
    { from: 'type', to: 'updateRecordType', whenOperation: ['update_dns_record'] },
    { from: 'name', to: 'updateRecordName', whenOperation: ['update_dns_record'] },
    { from: 'content', to: 'updateRecordContent', whenOperation: ['update_dns_record'] },
    { from: 'proxied', to: 'updateRecordProxied', whenOperation: ['update_dns_record'] },
    { from: 'tags', to: 'updateRecordTags', whenOperation: ['update_dns_record'] },
    { from: 'order', to: 'dnsOrder', whenOperation: ['list_dns_records'] },
    { from: 'status', to: 'certificateStatus', whenOperation: ['list_certificates'] },
  ],
  /**
   * Read Records moved its field projection off `fields`, which the shipped
   * block shared with the Create/Update Record JSON body. The two value spaces
   * are incompatible — a body sent as `sysparm_fields` goes out as
   * `[object Object]` — so the rename is scoped to Read Records and the body
   * keeps `fields` untouched on create and update.
   *
   * The operation scope is not enough on its own: a block configured for
   * Create Record and then switched to Read Records still holds the JSON body
   * under `fields`, so the value is guarded as well.
   */
  servicenow: [
    {
      from: 'fields',
      to: 'readFields',
      whenOperation: ['servicenow_read_record'],
      whenValue: isFieldProjection,
    },
  ],
  /**
   * One `sendEmail` switch used to serve activation, password reset,
   * deactivation, and deletion. Okta's API default is not uniform across those
   * — activation and reset default to sending, deactivation and removal to not
   * sending — so the switch split in two. `sendEmail` remains live for the
   * activation/reset half, so only the deactivation half is renamed.
   */
  okta: [
    {
      from: 'sendEmail',
      to: 'sendDeactivationEmail',
      whenOperation: ['okta_deactivate_user', 'okta_delete_user'],
    },
  ],
  rippling: [
    { from: 'action', to: '_removed_action' },
    { from: 'candidateDepartment', to: '_removed_candidateDepartment' },
    { from: 'candidatePhone', to: '_removed_candidatePhone' },
    { from: 'candidateStartDate', to: '_removed_candidateStartDate' },
    { from: 'email', to: '_removed_email' },
    { from: 'employeeId', to: '_removed_employeeId' },
    { from: 'endDate', to: '_removed_endDate' },
    { from: 'firstName', to: '_removed_firstName' },
    { from: 'groupId', to: '_removed_groupId' },
    { from: 'groupName', to: '_removed_groupName' },
    { from: 'groupVersion', to: '_removed_groupVersion' },
    { from: 'jobTitle', to: '_removed_jobTitle' },
    { from: 'lastName', to: '_removed_lastName' },
    { from: 'leaveRequestId', to: '_removed_leaveRequestId' },
    { from: 'managedBy', to: '_removed_managedBy' },
    { from: 'nextCursor', to: '_removed_nextCursor' },
    { from: 'offset', to: '_removed_offset' },
    { from: 'roleId', to: '_removed_roleId' },
    { from: 'spokeId', to: '_removed_spokeId' },
    { from: 'startDate', to: '_removed_startDate' },
    { from: 'status', to: '_removed_status' },
    { from: 'users', to: '_removed_users' },
  ],
  /**
   * `forwardId` fed a `concur-forwardid` request header on the receipt upload.
   * That header is documented nowhere in Concur's Receipts v4 or Image v1
   * references, so it was never honored — the value rode along on every upload
   * and did nothing. There is no replacement subblock to carry it to, and the
   * value is an opaque caller-chosen string rather than a secret, so it is
   * dropped outright.
   */
  sap_concur: [{ from: 'forwardId', to: '_removed_forwardId' }],
  /**
   * `uploadMimeType` was an advanced MIME Type input on Upload Document File whose
   * value the upload path never read: the content type is resolved from storage and
   * that resolution is never empty, so the field's value lost the `||` chain every
   * time. Dropped rather than renamed — there is no field for the value to move to.
   */
  vanta: [{ from: 'uploadMimeType', to: '_removed_uploadMimeType' }],
  /**
   * Three unrelated QuickBooks changes land here.
   *
   * The by-ID read moved off `transactionId`, which the shipped block shared
   * with every update and void. `tools.config.params` republishes that one
   * stored value as the read target AND as `paymentId`, `billId`,
   * `journalEntryId` and the rest, so a bill ID entered under Read Purchasing
   * Transactions survived a switch to Update Purchase Order and addressed the
   * wrong entity while the block still validated. `transactionId` stays live
   * for the mutations, so the rename is scoped to the three read operations
   * and a mutation's target is left where it is.
   *
   * The three `summarize_column_by` subsets collapsed into `reportSummarizeBy`,
   * which kept its ID. Every value the retired dropdowns could hold is in the
   * collapsed option list — Intuit documents the identical twelve values on all
   * fourteen report models that advertise the control, which is why the subsets
   * collapsed at all — so the stored value moves as-is rather than being
   * dropped, and no value guard is needed. The renames are unconditional so
   * that an occupied `reportSummarizeBy` wins and the retired key is discarded:
   * a block created before the collapse was seeded with `reportSummarizeBy`
   * too, so its live pick must never be clobbered by a subset control that was
   * hidden for the selected report type. The value is therefore recovered
   * exactly where nothing owns the target — YAML- and Copilot-authored blocks,
   * which persist only the fields they set. Order decides which subset wins if
   * a hand-authored state carries more than one; the three were mutually
   * exclusive per report type, so at most one can hold a real pick.
   *
   * `attachmentFileName` split: it now carries an `attachmentKind: 'file'`
   * clause for the upload path and the download-side name moved to
   * `downloadAttachmentFileName`. The source ID is still the upload override,
   * so the rename is scoped to the download operation and an add-side value
   * stays put.
   */
  quickbooks: [
    {
      from: 'transactionId',
      to: 'readTransactionId',
      whenOperation: [
        'quickbooks_read_sales_transactions',
        'quickbooks_read_purchasing_transactions',
        'quickbooks_read_accounting_transactions',
      ],
    },
    { from: 'reportCustomerSalesSummarizeBy', to: 'reportSummarizeBy' },
    { from: 'reportVendorExpenseSummarizeBy', to: 'reportSummarizeBy' },
    { from: 'reportTimeSummarizeBy', to: 'reportSummarizeBy' },
    {
      from: 'attachmentFileName',
      to: 'downloadAttachmentFileName',
      whenOperation: ['quickbooks_download_attachment'],
    },
  ],
}

/** Reads the value out of a stored subblock entry, tolerating a bare value. */
function storedSubblockValue(entry: unknown): unknown {
  if (isPlainRecord(entry)) return Object.hasOwn(entry, 'value') ? entry.value : null
  return entry
}

/** A stored value carries nothing worth migrating when it is absent or blank. */
function isBlankValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * The operation a block is currently configured for, or `null` when it has
 * none. An operation-scoped migration cannot fire without it: the whole point
 * of the scope is that the same stored ID means different things per operation,
 * so an unknown operation must leave the value alone.
 */
function selectedOperation(
  subBlocks: Record<string, BlockState['subBlocks'][string]>
): string | null {
  const value = storedSubblockValue(subBlocks.operation)
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Migrates legacy subblock IDs inside a single block's subBlocks map.
 * Returns a new subBlocks record if anything changed, or the original if not.
 */
function migrateBlockSubblockIds(
  blockType: string,
  subBlocks: Record<string, BlockState['subBlocks'][string]>,
  migrations: readonly SubblockIdMigration[]
): { subBlocks: Record<string, BlockState['subBlocks'][string]>; migrated: boolean } {
  let touched = false
  for (const { from } of migrations) {
    if (from in subBlocks) {
      touched = true
      break
    }
  }

  if (!touched) return { subBlocks, migrated: false }

  const result = { ...subBlocks }
  const blockConfig = getBlock(blockType)
  const operation = selectedOperation(subBlocks)
  let migrated = false

  for (const { from, to, whenOperation, whenValue } of migrations) {
    if (!(from in result)) continue

    // A `_removed_` target means the field no longer exists in the block. Drop
    // the value rather than parking it under a dead key: nothing ever reads
    // these keys, and secret scrubbing walks the block config, so a parked
    // `password: true` value would never be cleared and would ride along in
    // workflow exports and templates.
    if (to.startsWith(REMOVED_SUBBLOCK_ID_PREFIX)) {
      delete result[from]
      migrated = true
      continue
    }

    if (whenOperation) {
      // Scoped renames only fire for the operation that owned the written
      // value. The source ID is still a live control for some other operation,
      // so applying one outside its scope would steal that operation's value —
      // and so would deleting the source outside its scope.
      if (operation === null || !whenOperation.includes(operation)) continue

      /**
       * The collision guard for a scoped rename, and the whole discriminator
       * for "is this state older than the rename?".
       *
       * Presence of the target ID means the state was written by a block config
       * that already declared it. `prepareBlockState` materializes an entry for
       * EVERY declared subblock at block-creation time and the add-block write
       * persists that map wholesale, so a block created after a rename always
       * carries the new ID — seeded, or explicitly `null` when the control has
       * no seed. A block created before it cannot carry the new ID at all: the
       * loader reads `workflow_blocks.sub_blocks` verbatim and no load-time
       * step hydrates missing declared subblocks.
       *
       * So "target absent" is exactly "this state predates the rename", and it
       * is the only condition under which the legacy value may move.
       * Overwriting a target that is merely blank or still at its seeded
       * default would reopen the cross-operation leak the renames closed — a
       * `list_dns_records` name filter promoted onto `updateRecordName` renames
       * a live DNS record, and a Create Record JSON body promoted onto
       * `readFields` goes out as `sysparm_fields=[object Object]`.
       *
       * A legacy value is therefore never clobbered by a live user pick, and a
       * live user pick is never clobbered by a legacy value. Leaving the source
       * in place here is deliberate: the target already owns the value, and the
       * source may still be this block's control for another operation.
       */
      if (to in result) continue

      // Nothing to recover, and writing the blank through would only create a
      // second key holding the same emptiness.
      if (isBlankValue(storedSubblockValue(result[from]))) continue
    } else if (to in result) {
      // Unconditional rename onto an occupied target: the target wins and the
      // legacy value is discarded, which is how every pre-scoping entry here
      // has always behaved.
      delete result[from]
      migrated = true
      continue
    }

    // A value the target's space cannot represent belongs to whichever control
    // still owns the source ID. Leave it there rather than moving it into a
    // field that would send it as something it is not.
    if (whenValue && !whenValue(storedSubblockValue(result[from]))) continue

    const oldEntry: unknown = result[from]
    const configuredType = blockConfig?.subBlocks?.find((config) => config.id === to)?.type
    if (isPlainRecord(oldEntry)) {
      const type =
        configuredType ||
        (typeof oldEntry.type === 'string' && oldEntry.type.length > 0
          ? oldEntry.type === 'unknown'
            ? DEFAULT_SUBBLOCK_TYPE
            : oldEntry.type
          : DEFAULT_SUBBLOCK_TYPE)
      const value = Object.hasOwn(oldEntry, 'value') ? oldEntry.value : null

      result[to] = {
        ...oldEntry,
        id: to,
        type: type as BlockState['subBlocks'][string]['type'],
        value: value as BlockState['subBlocks'][string]['value'],
      }
    } else {
      result[to] = {
        id: to,
        type: configuredType || DEFAULT_SUBBLOCK_TYPE,
        value: oldEntry as BlockState['subBlocks'][string]['value'],
      }
    }
    delete result[from]
    migrated = true
  }

  return migrated ? { subBlocks: result, migrated: true } : { subBlocks, migrated: false }
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

    const migrations = SUBBLOCK_ID_MIGRATIONS[block.type]
    const renamed = migrations
      ? migrateBlockSubblockIds(block.type, block.subBlocks, migrations)
      : { subBlocks: block.subBlocks, migrated: false }
    const purged = dropParkedSubblocks(renamed.subBlocks)
    const changedSubBlocks = renamed.migrated || purged.dropped
    const renamedBlock = changedSubBlocks ? { ...block, subBlocks: purged.subBlocks } : block
    const sanitized = sanitizeMalformedSubBlocks(renamedBlock)
    const blockMigrated = changedSubBlocks || sanitized.changed

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
      anyMigrated = true
      result[blockId] = { ...renamedBlock, subBlocks: sanitized.subBlocks }
    } else {
      result[blockId] = block
    }
  }

  return { blocks: result, migrated: anyMigrated }
}

/**
 * One legacy-to-current `canonicalParamId` rename for a block type.
 *
 * Renaming a canonical id is otherwise invisible to persistence — values are
 * stored under subblock `id`, which does not move — with one exception:
 * `data.canonicalModes` is keyed by canonical id, so the old entry is orphaned
 * and the pair reverts to whatever {@link backfillCanonicalModes} infers.
 *
 * That inference is right whenever exactly one side holds a value, which is why
 * this is a narrow migration rather than a general one. It is wrong when BOTH
 * sides hold values: `setBlockCanonicalMode` writes the mode without clearing
 * the sibling, so a workflow that uploaded a file, switched to advanced, and
 * typed a reference has both — and `resolveCanonicalMode` prefers basic, which
 * would silently swap which value the run uses.
 */
export interface CanonicalIdMigration {
  /** The canonical id a legacy saved state stores the mode under. */
  from: string
  /** The canonical id the block definition declares now. */
  to: string
}

/** Canonical-id renames per block type. */
export const CANONICAL_ID_MIGRATIONS: Record<string, readonly CanonicalIdMigration[]> = {
  /**
   * The tool parameter is `file`, and `check-block-registry.ts` requires the
   * canonical id to match it once the parameter is `user-only` — which it
   * became so a direct `POST /api/v2/tools/{toolId}/execute` caller could
   * supply the document at all.
   */
  mistral_parse_v3: [{ from: 'document', to: 'file' }],
}

/**
 * Renames persisted canonical-mode keys whose block definition moved them.
 *
 * Runs before {@link backfillCanonicalModes} so a carried-over selection is
 * already present and the backfill leaves it alone; anything genuinely missing
 * still gets inferred there.
 */
export function migrateCanonicalModeIds(blocks: Record<string, BlockState>): {
  blocks: Record<string, BlockState>
  migrated: boolean
} {
  let anyMigrated = false
  const result: Record<string, BlockState> = {}

  for (const [blockId, block] of Object.entries(blocks)) {
    const migrations = CANONICAL_ID_MIGRATIONS[block.type]
    const modes = block.data?.canonicalModes
    if (!migrations || !isPlainRecord(modes)) {
      result[blockId] = block
      continue
    }

    type CanonicalModes = Record<string, 'basic' | 'advanced'>
    let patched: CanonicalModes | null = null
    for (const { from, to } of migrations) {
      if (!(from in modes)) continue
      const next: CanonicalModes = patched ?? { ...(modes as CanonicalModes) }
      // A value already stored under the current id wins: it was written by the
      // current definition, so it is newer than the legacy one.
      if (!(to in next)) next[to] = next[from]
      delete next[from]
      patched = next
    }

    if (!patched) {
      result[blockId] = block
      continue
    }

    logger.info('Migrated legacy canonical-mode ids', { blockId: block.id, blockType: block.type })
    anyMigrated = true
    result[blockId] = { ...block, data: { ...block.data, canonicalModes: patched } }
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

    // canonical-index-unscoped: the backfill writes a mode only for canonical PAIRS, whose two
    // members always sit on the same surface — a cross-surface alias joins an existing group
    // rather than forming a pair, so scoping cannot change what gets backfilled.
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
