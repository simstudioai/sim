import { createLogger } from '@sim/logger'
import { generateId, generateShortId, isValidUuid } from '@sim/utils/id'
import { isRecordLike, sortObjectKeysDeep } from '@sim/utils/object'
import { buildCanonicalIndex, isCanonicalPair } from '@sim/workflow-code/catalog/canonical-index'
import {
  type BlockRetryConfig,
  getWorkflowBranchHandleId,
  normalizeBlockRetryTries,
  normalizeBlockRetryWaitMs,
  type WorkflowBranchKind,
  type WorkflowState,
  wouldCreateCycle,
} from '@sim/workflow-types/workflow'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { resolveAvailableAgentDefaultModel } from '@/lib/permission-groups/model-access.server'
import type { SeedValueGate } from '@/lib/permission-groups/operation-access'
import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/outputs'
import { getConditionRows, getRouterRows } from '@/lib/workflows/dynamic-handle-topology'
import {
  checkRetrySetting,
  createFieldValueGate,
  createSeededValueGate,
  isToolInputField,
  partitionToolEntries,
} from '@/lib/workflows/editing/gates'
import { buildDefaultCanonicalModes } from '@/lib/workflows/subblocks/visibility'
import { applyAgentToolUsageControlModes } from '@/lib/workflows/tool-input/usage-control'
import { hasTriggerCapability } from '@/lib/workflows/triggers/utils'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig, SubBlockType } from '@/blocks/types'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'
import type { EditWorkflowOperation, SkippedItem, ValidationError } from './types'
import { logSkippedItem } from './types'
import {
  validateInputsForBlock,
  validateSourceHandleForBlock,
  validateTargetHandle,
} from './validation'

/**
 * Merges a requested retry policy onto whatever the block already had, clamped
 * to the executor's bounds.
 *
 * `enabled` is optional and falls back to the block's current state (or `true`
 * for a block with no policy yet), so `{maxTries: 4}` reads as "retry four
 * times" rather than silently storing a disabled policy. Numbers are kept when
 * only `enabled` changes, matching the editor: toggling retry off and back on
 * restores what was configured instead of resetting to the defaults.
 *
 * Clamped through the shared normalizers rather than rejected, so a value that
 * drifts outside the bounds still yields a runnable policy — same contract the
 * editor and executor already follow.
 */
export function resolveBlockRetryUpdate(
  requested: Partial<BlockRetryConfig>,
  existing: BlockRetryConfig | undefined
): BlockRetryConfig {
  return {
    enabled:
      typeof requested.enabled === 'boolean' ? requested.enabled : (existing?.enabled ?? true),
    maxTries: normalizeBlockRetryTries(requested.maxTries ?? existing?.maxTries),
    waitBetweenTriesMs: normalizeBlockRetryWaitMs(
      requested.waitBetweenTriesMs ?? existing?.waitBetweenTriesMs
    ),
  }
}

/**
 * Applies a requested retry policy to a block, or records why it could not be: the `retry` gates
 * of `BLOCK_GATES` decide, so a policy the runtime would ignore is reported back instead of
 * being written as dead configuration.
 */
export function applyBlockRetry(
  block: any,
  requested: unknown,
  context: { operationType: string; blockId: string; skippedItems?: SkippedItem[] },
  permissionConfig: PermissionGroupConfig | null = null
): void {
  if (requested === null) {
    block.retry = undefined
    return
  }
  if (typeof requested !== 'object' || Array.isArray(requested)) return

  const refusal = checkRetrySetting(
    {
      blockId: context.blockId,
      blockType: block.type,
      triggerMode: block.triggerMode,
      operationType: context.operationType,
    },
    { permissionConfig }
  )
  if (refusal) {
    if (context.skippedItems) logSkippedItem(context.skippedItems, refusal)
    return
  }

  block.retry = resolveBlockRetryUpdate(requested as Partial<BlockRetryConfig>, block.retry)
}

/**
 * The value an unset sub-block starts with on the API path.
 *
 * Mirrors the editor's `prepareBlockState`: a sub-block whose config declares a
 * `value()` thunk is pre-filled from it, so a block added through
 * `operations apply` carries the same defaults as one dropped on the canvas.
 * Without this a `generic_webhook` arrives with `token: null` and deploy
 * refuses it as "authentication enabled but no token", although the editor
 * would have generated one. The thunk sees the values the caller did write, so
 * a default that depends on a sibling field resolves against the real block.
 *
 * Hidden and read-only sub-blocks are left alone: a hidden thunk is computed
 * by the serializer at run time from the block's other fields, and a read-only
 * field is display-only. A viewer-scoped default (`valueScope: 'viewer'`) is the
 * editor's alone: the server's environment is nobody's. Hidden `defaultValue`s
 * keep their compatibility seeding. A seeded value the caller's permission group denies is withheld
 * silently, as the editor withholds it — it is a default nobody asked for, not
 * a refused operation, so it records no skip.
 */
function resolveSeededSubBlockValue(
  subBlock: SubBlockConfig,
  writtenValues: Record<string, unknown>,
  isSeededValueAllowed: SeedValueGate
): unknown {
  if (
    typeof subBlock.value === 'function' &&
    !subBlock.hidden &&
    !subBlock.readOnly &&
    subBlock.valueScope !== 'viewer'
  ) {
    try {
      const seeded: unknown = subBlock.value(writtenValues)
      if (
        seeded !== undefined &&
        seeded !== null &&
        (typeof seeded !== 'string' || isSeededValueAllowed(subBlock.id, seeded))
      ) {
        return seeded
      }
    } catch {
      /* An unresolvable thunk seeds nothing, same as the editor. */
    }
  }
  if (subBlock.hidden && subBlock.defaultValue !== undefined) {
    return structuredClone(subBlock.defaultValue)
  }
  return null
}

/**
 * Helper to create a block state from operation params
 */
export function createBlockFromParams(
  blockId: string,
  params: any,
  parentId?: string,
  errorsCollector?: ValidationError[],
  permissionConfig?: PermissionGroupConfig | null,
  skippedItems?: SkippedItem[],
  enforceToolBindingContract = false
): any {
  const blockConfig = getBlock(params.type)
  const triggerMode = params.triggerMode || false
  const isTriggerCapable = blockConfig ? hasTriggerCapability(blockConfig) : false
  const effectiveTriggerMode = Boolean(triggerMode && isTriggerCapable)

  // Validate inputs against block configuration
  let validatedInputs: Record<string, any> | undefined
  if (params.inputs) {
    const result = validateInputsForBlock(
      params.type,
      params.inputs,
      blockId,
      {},
      enforceToolBindingContract,
      effectiveTriggerMode
    )
    validatedInputs = result.validInputs
    if (errorsCollector && result.errors.length > 0) {
      errorsCollector.push(...result.errors)
    }
  }

  const blockState: any = {
    id: blockId,
    type: params.type,
    name: params.name,
    position: { x: 0, y: 0 },
    enabled: params.enabled !== undefined ? params.enabled : true,
    horizontalHandles: true,
    advancedMode: params.advancedMode || false,
    height: 0,
    triggerMode: triggerMode,
    subBlocks: {},
    outputs: params.outputs || {},
    data: parentId ? { parentId, extent: 'parent' as const } : {},
    locked: false,
  }

  // Block-level setting like `enabled`, not a subBlock input — the executor
  // reads it from block state when wrapping the run, never from the tool params.
  if (params.retry !== undefined) {
    applyBlockRetry(
      blockState,
      params.retry,
      { operationType: 'add', blockId, skippedItems },
      permissionConfig ?? null
    )
  }

  // Add validated inputs as subBlocks
  if (validatedInputs) {
    const isInputAllowed = createSubBlockInputGate({
      blockType: params.type,
      permissionConfig,
      blockId,
      operationType: 'add',
      skippedItems: skippedItems ?? [],
    })
    Object.entries(validatedInputs).forEach(([key, value]) => {
      if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
        return
      }

      if (!isInputAllowed(key, value)) {
        return
      }

      let sanitizedValue = normalizeSubblockValue(key, value, params.type)

      sanitizedValue = normalizeConditionRouterIds(blockId, key, sanitizedValue)

      sanitizedValue = gateToolInputValue(
        { blockId, blockType: params.type, key, value, sanitizedValue },
        permissionConfig ?? null,
        skippedItems ?? []
      )

      // Special handling for responseFormat - normalize to ensure consistent format
      if (key === 'responseFormat' && value) {
        sanitizedValue = normalizeResponseFormat(value)
      }

      const subBlockDef = blockConfig?.subBlocks.find((subBlock) => subBlock.id === key)
      blockState.subBlocks[key] = {
        id: key,
        type: subBlockDef?.type || 'short-input',
        value: sanitizedValue,
      }
    })
  }

  // Set up subBlocks from block configuration
  if (blockConfig) {
    const isSeededValueAllowed = createSeededValueGate(params.type, permissionConfig)
    const writtenValues: Record<string, unknown> = Object.fromEntries(
      Object.entries(blockState.subBlocks).map(([key, subBlock]: [string, any]) => [
        key,
        subBlock.value,
      ])
    )
    blockConfig.subBlocks.forEach((subBlock) => {
      if (!blockState.subBlocks[subBlock.id]) {
        const agentDefault =
          params.type === 'agent' && subBlock.id === 'model'
            ? resolveAvailableAgentDefaultModel(permissionConfig)
            : null
        blockState.subBlocks[subBlock.id] = {
          id: subBlock.id,
          type: subBlock.type,
          value:
            agentDefault ??
            resolveSeededSubBlockValue(subBlock, writtenValues, isSeededValueAllowed),
        }
      } else {
        blockState.subBlocks[subBlock.id].type = subBlock.type
      }
    })

    const defaultModes = buildDefaultCanonicalModes(blockConfig.subBlocks)
    if (Object.keys(defaultModes).length > 0) {
      if (!blockState.data) blockState.data = {}
      blockState.data.canonicalModes = defaultModes
    }

    if (validatedInputs) {
      updateCanonicalModesForInputs(blockState, Object.keys(validatedInputs), blockConfig)
      const tools = blockState.subBlocks.tools?.value
      if ((params.type === 'agent' || params.type === 'mothership') && Array.isArray(tools)) {
        blockState.data = {
          ...blockState.data,
          canonicalModes: applyAgentToolUsageControlModes(tools, blockState.data?.canonicalModes),
        }
      }
    }
  }

  // Initialize default conditions/routes so edge handle validation works.
  // The UI does this in the React component; we need to mirror it here.
  if (params.type === 'condition' && !blockState.subBlocks.conditions?.value) {
    blockState.subBlocks.conditions = {
      id: 'conditions',
      type: 'condition-input',
      value: JSON.stringify([
        { id: generateId(), title: 'if', value: '' },
        { id: generateId(), title: 'else', value: '' },
      ]),
    }
  } else if (params.type === 'router_v2' && !blockState.subBlocks.routes?.value) {
    blockState.subBlocks.routes = {
      id: 'routes',
      type: 'router-input',
      value: JSON.stringify([{ id: generateId(), title: 'Route 1', value: '' }]),
    }
  }

  if (blockConfig && !params.outputs) {
    blockState.outputs = getEffectiveBlockOutputs(params.type, blockState.subBlocks, {
      triggerMode: effectiveTriggerMode,
      preferToolOutputs: !effectiveTriggerMode,
    })
  }

  return blockState
}

export function updateCanonicalModesForInputs(
  block: { data?: { canonicalModes?: Record<string, 'basic' | 'advanced'> } },
  inputKeys: string[],
  blockConfig: BlockConfig
): void {
  if (!blockConfig.subBlocks?.length) return

  // canonical-index-unscoped: structural only — this maps written input ids to the mode they
  // imply and reads no values, so neither surface can shadow the other.
  const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks)
  const canonicalModeUpdates: Record<string, 'basic' | 'advanced'> = {}

  for (const inputKey of inputKeys) {
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[inputKey]
    if (!canonicalId) continue

    const group = canonicalIndex.groupsById[canonicalId]
    if (!group || !isCanonicalPair(group)) continue

    const isAdvanced = group.advancedIds.includes(inputKey)
    const existingMode = canonicalModeUpdates[canonicalId]

    if (!existingMode || isAdvanced) {
      canonicalModeUpdates[canonicalId] = isAdvanced ? 'advanced' : 'basic'
    }
  }

  if (Object.keys(canonicalModeUpdates).length > 0) {
    if (!block.data) block.data = {}
    if (!block.data.canonicalModes) block.data.canonicalModes = {}
    Object.assign(block.data.canonicalModes, canonicalModeUpdates)
  }
}

/**
 * Normalize tools array by adding back fields that were sanitized for training
 */
export function normalizeTools(tools: any[]): any[] {
  return tools.map((tool) => {
    if (tool.type === 'custom-tool') {
      // New reference format: minimal fields only
      if (tool.customToolId && !tool.schema && !tool.code) {
        return {
          type: tool.type,
          customToolId: tool.customToolId,
          usageControl:
            tool.usageControl || (tool.usageControlExpression === undefined ? 'auto' : undefined),
          usageControlExpression: tool.usageControlExpression,
          isExpanded: tool.isExpanded ?? true,
        }
      }

      // Legacy inline format: include all fields
      const normalized: any = {
        ...tool,
        params: tool.params || {},
        isExpanded: tool.isExpanded ?? true,
      }

      // Ensure schema has proper structure (for inline format)
      if (normalized.schema?.function) {
        normalized.schema = {
          type: 'function',
          function: {
            name: normalized.schema.function.name || tool.title, // Preserve name or derive from title
            description: normalized.schema.function.description,
            parameters: normalized.schema.function.parameters,
          },
        }
      }

      return normalized
    }

    // For other tool types, just ensure isExpanded exists
    return {
      ...tool,
      isExpanded: tool.isExpanded ?? true,
    }
  })
}

/**
 * Subblock types that store arrays of objects with `id` fields.
 * The LLM may generate arbitrary IDs which need to be converted to proper UUIDs.
 */
const ARRAY_WITH_ID_SUBBLOCK_TYPES = new Set([
  'inputFormat', // input-format: Fields with id, name, type, value, collapsed
  'headers', // table: Rows with id, cells (used for HTTP headers)
  'params', // table: Rows with id, cells (used for query params)
  'variables', // table or variables-input: Rows/assignments with id
  'tagFilters', // knowledge-tag-filters: Filters with id, tagName, etc.
  'documentTags', // document-tag-entry: Tags with id, tagName, etc.
  'metrics', // eval-input: Metrics with id, name, description, range
  'conditions', // condition-input: Condition branches with id, title, value
  'routes', // router-input: Router routes with id, title, value
])

/**
 * Subblock keys whose UI components expect a JSON string, not a raw array.
 * After normalizeArrayWithIds returns an array, these must be re-stringified.
 */
const JSON_STRING_SUBBLOCK_KEYS = new Set(['conditions', 'routes', 'tagFilters', 'documentTags'])

/**
 * Coerces a subblock value to an array, accepting either a raw array or the JSON string
 * the string-serialized subblocks persist.
 *
 * @returns The array, or `null` when the value is not an array and does not parse to one.
 * Callers supply their own fallback, which differs by site.
 */
function parseJsonArray(value: unknown): any[] | null {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return null

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Normalizes array subblock values by ensuring each item has a valid UUID.
 * The LLM may generate arbitrary IDs like "input-desc-001" or "row-1" which need
 * to be converted to proper UUIDs for consistency with UI-created items.
 */
function normalizeArrayWithIds(value: unknown): any[] {
  const arr = parseJsonArray(value)
  if (!arr) return []

  return arr.map((item: any) => {
    if (!item || typeof item !== 'object') {
      return item
    }

    const hasValidUUID = typeof item.id === 'string' && isValidUuid(item.id)
    if (!hasValidUUID) {
      return { ...item, id: generateId() }
    }

    return item
  })
}

/**
 * Checks if a subblock key should have its array items normalized with UUIDs.
 */
function shouldNormalizeArrayIds(key: string): boolean {
  return ARRAY_WITH_ID_SUBBLOCK_TYPES.has(key)
}

/** Subblock types whose value is a list of rows each carrying an `id`. */
const ARRAY_WITH_ID_TYPES = new Set<SubBlockType>([
  'input-format',
  'table',
  'variables-input',
  'knowledge-tag-filters',
  'document-tag-entry',
  'eval-input',
  'condition-input',
  'router-input',
])

/**
 * Normalizes an array-with-id subblock value, re-serializing it to a JSON string for the
 * subblock keys whose UI components read a string rather than a raw array.
 *
 * Every write path that persists LLM-supplied subblock values must route through this so the
 * two concerns cannot drift apart; returns non-array-with-id values untouched. The key names a
 * row list only where `blockType` declares it as one: another type can use the same id for a
 * different kind of field (a JSON code field named `params`), whose value is not rows.
 *
 * @remarks
 * A nullish value passes through unchanged. `validateValueForSubBlockType` treats null as an
 * explicit clear, and coercing it to `"[]"` here would persist a value where the caller asked
 * for none -- leaving `sanitizeForCopilot` to show the agent an empty filter rather than an
 * absent one, and callers that branch on the field's presence to see it as set.
 */
export function normalizeSubblockValue(key: string, value: unknown, blockType?: string): unknown {
  if (!shouldNormalizeArrayIds(key)) return value
  const declared = blockType
    ? getBlock(blockType)?.subBlocks.find((subBlock) => subBlock.id === key)
    : undefined
  if (declared && !ARRAY_WITH_ID_TYPES.has(declared.type)) return value
  if (value === null || value === undefined) return value
  const normalized = normalizeArrayWithIds(value)
  return JSON_STRING_SUBBLOCK_KEYS.has(key) ? JSON.stringify(normalized) : normalized
}

/** How each branch subBlock's rows are read back and named on their edges. */
const BRANCH_LISTS = {
  conditions: { kind: 'condition', storedRows: getConditionRows },
  routes: { kind: 'router', storedRows: getRouterRows },
} as const satisfies Record<
  string,
  {
    kind: WorkflowBranchKind
    storedRows: (blockId: string, value: unknown) => ReadonlyArray<{ id: string }>
  }
>

type BranchListKey = keyof typeof BRANCH_LISTS

function isBranchListKey(key: string): key is BranchListKey {
  return Object.hasOwn(BRANCH_LISTS, key)
}

/**
 * The positional slot of each of `count` rows, spelled as its canonical id suffix: `if`,
 * `else-if-0`, …, `else` for a condition, and `route1`, `route2`, … for a router (matching the
 * canvas's first route id).
 */
function branchSlots(key: BranchListKey, count: number): string[] {
  let elseIfCounter = 0
  return Array.from({ length: count }, (_, index) => {
    if (key === 'routes') return `route${index + 1}`
    if (index === 0) return 'if'
    if (index === count - 1) return 'else'
    return `else-if-${elseIfCounter++}`
  })
}

/**
 * Assigns ids to branch `rows`, keeping stored ids where a row is the same branch, in this order:
 * an unchanged row (same slot, same expression) keeps its id; then a row takes the id of a stored
 * row with the same non-empty expression (so a branch keeps its edges when the rows around it are
 * inserted, removed or reordered); then the id of the stored row in its slot; else its canonical
 * id `<blockId>-<slot>`, or a fresh one when a stored row holds that. An `else` row matches only
 * by slot: its expression is ignored and usually empty.
 */
function assignBranchIds(
  blockId: string,
  key: BranchListKey,
  rows: unknown[],
  stored: ReadonlyArray<{ id: string; value?: unknown }>
): unknown[] {
  const slots = branchSlots(key, rows.length)
  const storedSlots = branchSlots(key, stored.length)
  const storedInSlot = (index: number) => stored[storedSlots.indexOf(slots[index])]
  const ids: Array<string | undefined> = rows.map(() => undefined)
  const claimed = new Set<string>()
  const claimEach = (pick: (row: Record<string, unknown>, index: number) => string | undefined) => {
    rows.forEach((row, index) => {
      if (ids[index] !== undefined || !isRecordLike(row)) return
      const id = pick(row, index)
      if (id === undefined || claimed.has(id)) return
      claimed.add(id)
      ids[index] = id
    })
  }

  claimEach((row, index) => {
    const same = storedInSlot(index)
    return same && same.value === row.value ? same.id : undefined
  })
  claimEach((row, index) => {
    if (slots[index] === 'else' || typeof row.value !== 'string' || row.value === '') return
    return stored.find(
      (candidate, at) =>
        storedSlots[at] !== 'else' && candidate.value === row.value && !claimed.has(candidate.id)
    )?.id
  })
  claimEach((_, index) => storedInSlot(index)?.id)

  const taken = new Set(stored.map((row) => row.id))
  return rows.map((row, index) => {
    if (!isRecordLike(row)) return row
    const kept = ids[index]
    if (kept !== undefined) return { ...row, id: kept }
    const canonical = `${blockId}-${slots[index]}`
    const id = taken.has(canonical) ? `${canonical}-${generateShortId(8)}` : canonical
    taken.add(id)
    return { ...row, id }
  })
}

/**
 * Assigns canonical block-scoped branch ids to a new block's condition/router rows. The caller
 * provides the branch structure (if/else-if/else or routes) but not the internal ids.
 */
export function normalizeConditionRouterIds(blockId: string, key: string, value: unknown): unknown {
  if (!isBranchListKey(key)) return value
  const parsed = parseJsonArray(value)
  if (!parsed) return value
  const normalized = assignBranchIds(blockId, key, parsed, [])
  return typeof value === 'string' ? JSON.stringify(normalized) : normalized
}

/**
 * Applies a re-sent condition/router branch list to existing block `blockId` in one mutation.
 * Stored edges name rows as `condition-<id>` / `router-<id>`, and the canvas mints ids such as
 * `<blockId>-else-if-<timestamp>`, so a re-sent row that is the same branch keeps its stored id
 * ({@link assignBranchIds}) instead of a positional one that would orphan its edges. The block's
 * edges from a stored row the list no longer holds are removed rather than left naming no branch.
 * Returns the value to store; any other key passes through.
 */
export function applyEditedBranchRows(
  modifiedState: Pick<WorkflowState, 'blocks' | 'edges'>,
  blockId: string,
  key: string,
  value: unknown
): unknown {
  if (!isBranchListKey(key)) return value
  const parsed = parseJsonArray(value)
  if (!parsed) return value
  const { kind, storedRows } = BRANCH_LISTS[key]
  const stored = storedRows(blockId, modifiedState.blocks[blockId]?.subBlocks?.[key]?.value)
  const rows = assignBranchIds(blockId, key, parsed, stored)

  const keptIds = new Set(rows.map((row) => (isRecordLike(row) ? row.id : undefined)))
  const droppedHandles = new Set(
    stored
      .filter((row) => !keptIds.has(row.id))
      .map((row) => getWorkflowBranchHandleId(kind, row.id))
  )
  if (droppedHandles.size > 0) {
    modifiedState.edges = modifiedState.edges.filter(
      (edge) => !(edge.source === blockId && droppedHandles.has(edge.sourceHandle ?? ''))
    )
  }
  return typeof value === 'string' ? JSON.stringify(rows) : rows
}

/**
 * Normalize responseFormat to ensure consistent storage
 * Handles both string (JSON) and object formats
 * Returns pretty-printed JSON for better UI readability
 */
export function normalizeResponseFormat(value: any): string {
  try {
    let obj = value

    // If it's already a string, parse it first
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) {
        return ''
      }
      obj = JSON.parse(trimmed)
    }

    // If it's an object, stringify it with consistent formatting
    if (obj && typeof obj === 'object') {
      // Return pretty-printed with 2-space indentation for UI readability
      // The sanitizer will normalize it to minified format for comparison
      return JSON.stringify(sortObjectKeysDeep(obj), null, 2)
    }

    return String(value)
  } catch {
    // If parsing fails, return the original value as string
    return String(value)
  }
}

/**
 * Creates a validated edge between two blocks.
 * Returns true if edge was created, false if skipped due to validation errors.
 *
 * `storedEdges` holds the edges the workflow stored before this apply (see
 * {@link storedEdgeKeys}). Re-sending one is restating it, not adding it: it is
 * kept even where the engine would refuse a new edge, so a stored error edge
 * from a container or a stored cycle survives an edit that rewrites the block's
 * connections.
 */
export function createValidatedEdge(
  modifiedState: any,
  sourceBlockId: string,
  targetBlockId: string,
  sourceHandle: string,
  targetHandle: string,
  operationType: string,
  logger: ReturnType<typeof createLogger>,
  skippedItems?: SkippedItem[],
  storedEdges?: ReadonlySet<string>
): boolean {
  if (!modifiedState.blocks[targetBlockId]) {
    // The target doesn't exist yet. It may be created by a later operation in
    // this batch or by a future edit_workflow call. Record the connection as
    // pending on the source block (persisted in block.data) so it is resolved
    // automatically once the target appears, instead of being silently dropped.
    const pendingSource = modifiedState.blocks[sourceBlockId]
    if (pendingSource) {
      if (!pendingSource.data) pendingSource.data = {}
      if (!pendingSource.data.pendingConnections) pendingSource.data.pendingConnections = {}
      const pending = pendingSource.data.pendingConnections as Record<
        string,
        Array<{ target: string; targetHandle: string }>
      >
      if (!pending[sourceHandle]) pending[sourceHandle] = []
      if (
        !pending[sourceHandle].some(
          (p) => p.target === targetBlockId && p.targetHandle === targetHandle
        )
      ) {
        pending[sourceHandle].push({ target: targetBlockId, targetHandle })
      }
    }
    logger.warn(`Target block "${targetBlockId}" not found. Connection deferred until it exists.`, {
      sourceBlockId,
      targetBlockId,
      sourceHandle,
    })
    skippedItems?.push({
      type: 'invalid_edge_target',
      operationType,
      blockId: sourceBlockId,
      reason: `Edge from "${sourceBlockId}" to "${targetBlockId}" deferred until the target block "${targetBlockId}" exists - if it is created later (in this or a following edit) the engine wires this edge automatically; if you did not intend to create "${targetBlockId}", fix the target id.`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const sourceBlock = modifiedState.blocks[sourceBlockId]
  if (!sourceBlock) {
    logger.warn(`Source block "${sourceBlockId}" not found. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
    })
    skippedItems?.push({
      type: 'invalid_edge_source',
      operationType,
      blockId: sourceBlockId,
      reason: `Edge from "${sourceBlockId}" to "${targetBlockId}" skipped - source block does not exist`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const sourceBlockType = sourceBlock.type
  if (!sourceBlockType) {
    logger.warn(`Source block "${sourceBlockId}" has no type. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
    })
    skippedItems?.push({
      type: 'invalid_edge_source',
      operationType,
      blockId: sourceBlockId,
      reason: `Edge from "${sourceBlockId}" to "${targetBlockId}" skipped - source block has no type`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const sourceValidation = validateSourceHandleForBlock(sourceHandle, sourceBlockType, sourceBlock)
  // An error edge the graph already stored is kept even where the engine no longer adds one
  // (from a loop or parallel): re-sending a block's connections must not drop it.
  const restatedErrorEdge =
    sourceHandle === 'error' && storedEdges?.has(edgeKey(sourceBlockId, 'error', targetBlockId))
  if (!sourceValidation.valid && !restatedErrorEdge) {
    logger.warn(`Invalid source handle. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
      sourceHandle,
      error: sourceValidation.error,
    })
    skippedItems?.push({
      type: 'invalid_source_handle',
      operationType,
      blockId: sourceBlockId,
      reason: sourceValidation.error || `Invalid source handle "${sourceHandle}"`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const targetValidation = validateTargetHandle(targetHandle)
  if (!targetValidation.valid) {
    logger.warn(`Invalid target handle. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
      targetHandle,
      error: targetValidation.error,
    })
    skippedItems?.push({
      type: 'invalid_target_handle',
      operationType,
      blockId: sourceBlockId,
      reason: targetValidation.error || `Invalid target handle "${targetHandle}"`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  // Use normalized handle if available (e.g., 'if' -> 'condition-{uuid}')
  const finalSourceHandle = sourceValidation.normalizedHandle || sourceHandle

  // Avoid creating duplicate edges (e.g., when a pending connection resolves to
  // the same edge a later operation already created).
  const edgeExists = (modifiedState.edges || []).some(
    (e: any) =>
      e.source === sourceBlockId &&
      e.sourceHandle === finalSourceHandle &&
      e.target === targetBlockId &&
      e.targetHandle === targetHandle
  )
  if (edgeExists) return true

  // The canvas and realtime refuse a cycle with the same check, and the executor cannot run one.
  if (
    !storedEdges?.has(edgeKey(sourceBlockId, finalSourceHandle, targetBlockId)) &&
    wouldCreateCycle(modifiedState.edges || [], sourceBlockId, targetBlockId)
  ) {
    logger.warn('Edge would close a cycle. Edge skipped.', {
      sourceBlockId,
      targetBlockId,
      sourceHandle: finalSourceHandle,
    })
    skippedItems?.push({
      type: 'edge_cycle',
      operationType,
      blockId: sourceBlockId,
      reason:
        sourceBlockId === targetBlockId
          ? `Edge from "${sourceBlockId}" to itself skipped - a block wired to itself waits on its own output and never runs. To repeat work, put the block inside a loop container instead.`
          : `Edge from "${sourceBlockId}" to "${targetBlockId}" skipped - "${targetBlockId}" already leads back to "${sourceBlockId}", so this edge would close a cycle and no block on it would run. Do not wire back to an earlier block; to repeat work, put the blocks inside a loop container (or a parallel one to fan out).`,
      details: { sourceHandle: finalSourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  modifiedState.edges.push({
    id: generateId(),
    source: sourceBlockId,
    sourceHandle: finalSourceHandle,
    target: targetBlockId,
    targetHandle,
    type: 'default',
  })
  return true
}

/** A connection target as `{ block, handle? }`, or `null` when the value is not one. */
function asConnectionTarget(value: unknown): { block: string; handle?: string } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.block !== 'string' || record.block === '') return null
  return {
    block: record.block,
    handle: typeof record.handle === 'string' ? record.handle : undefined,
  }
}

const CONNECTION_TARGET_SHAPES = 'a target block id, {block, handle?}, or an array of those'
const CONNECTION_ARRAY_ENTRY_SHAPES = 'a target block id or {block, handle?}'

/** The key of an edge in {@link storedEdgeKeys}. */
function edgeKey(source: string, sourceHandle: string | null | undefined, target: string): string {
  return `${source}\u0000${sourceHandle ?? 'source'}\u0000${target}`
}

/** The edges a graph stores, for {@link createValidatedEdge}'s `storedEdges`. */
export function storedEdgeKeys(
  edges: ReadonlyArray<{ source: string; target: string; sourceHandle?: string | null }>
): Set<string> {
  return new Set(edges.map((edge) => edgeKey(edge.source, edge.sourceHandle, edge.target)))
}

/**
 * Adds connections as edges for a block.
 * Supports multiple target formats:
 * - String: "target-block-id"
 * - Object: { block: "target-block-id", handle?: "custom-target-handle" }
 * - Array of strings or objects
 *
 * A value of any other shape — `{ incoming: [...] }`, `{ source: { target } }`
 * — is recorded as an input validation error naming the handle and the
 * accepted shapes. It used to be ignored, so an operation whose wiring never
 * happened still answered `applied: 1` with nothing in `skipped`. A handle the
 * block type does not have is already reported by {@link createValidatedEdge}
 * as an `invalid_source_handle` skip.
 */
export function addConnectionsAsEdges(
  modifiedState: any,
  blockId: string,
  connections: Record<string, any>,
  logger: ReturnType<typeof createLogger>,
  skippedItems?: SkippedItem[],
  validationErrors?: ValidationError[],
  storedEdges?: ReadonlySet<string>
): void {
  const normalizeHandle = (handle: string): string => {
    if (handle === 'success') return 'source'
    return handle
  }

  const rejectShape = (path: string, value: unknown, expected: string) => {
    const error = `connections${path}: expected ${expected}`
    logger.warn('Connection target has an unsupported shape. Connection dropped.', {
      blockId,
      error,
    })
    validationErrors?.push({
      blockId,
      blockType: modifiedState.blocks?.[blockId]?.type ?? 'unknown',
      field: 'connections',
      value,
      error,
    })
  }

  Object.entries(connections).forEach(([rawHandle, targets]) => {
    if (targets === null || targets === undefined) return

    const sourceHandle = normalizeHandle(rawHandle)
    const handlePath = `[${JSON.stringify(rawHandle)}]`

    const addEdgeForTarget = (targetBlock: string, targetHandle?: string) => {
      createValidatedEdge(
        modifiedState,
        blockId,
        targetBlock,
        sourceHandle,
        targetHandle || 'target',
        'add_edge',
        logger,
        skippedItems,
        storedEdges
      )
    }

    if (typeof targets === 'string') {
      addEdgeForTarget(targets)
      return
    }

    if (Array.isArray(targets)) {
      targets.forEach((target: unknown, index: number) => {
        if (typeof target === 'string') {
          addEdgeForTarget(target)
          return
        }
        const parsed = asConnectionTarget(target)
        if (parsed) {
          addEdgeForTarget(parsed.block, parsed.handle)
          return
        }
        rejectShape(`${handlePath}[${index}]`, target, CONNECTION_ARRAY_ENTRY_SHAPES)
      })
      return
    }

    const parsed = asConnectionTarget(targets)
    if (parsed) {
      addEdgeForTarget(parsed.block, parsed.handle)
      return
    }
    rejectShape(handlePath, targets, CONNECTION_TARGET_SHAPES)
  })
}

export function applyTriggerConfigToBlockSubblocks(
  block: any,
  triggerConfig: Record<string, any>,
  isInputAllowed: SubBlockInputGate = ALLOW_ALL_INPUTS
) {
  if (!block?.subBlocks || !triggerConfig || typeof triggerConfig !== 'object') {
    return
  }

  Object.entries(triggerConfig).forEach(([configKey, configValue]) => {
    /* `triggerConfig` is a runtime id the validated write path rejects, so its
       keys reach sibling subBlocks only through here — redistributing an
       aggregate persisted before the group's denylist changed. Same gate, so a
       denied operation cannot be re-applied by the redistribution. */
    if (!isInputAllowed(configKey, configValue)) return
    const existingSubblock = block.subBlocks[configKey]
    if (existingSubblock) {
      const existingValue = existingSubblock.value
      const valuesEqual =
        typeof existingValue === 'object' || typeof configValue === 'object'
          ? JSON.stringify(existingValue) === JSON.stringify(configValue)
          : existingValue === configValue

      if (valuesEqual) {
        return
      }

      block.subBlocks[configKey] = {
        ...existingSubblock,
        value: configValue,
      }
    } else {
      // The registry type is authoritative for declared keys; `short-input` is
      // only the keep-alive default for dynamic trigger-config keys the block
      // config does not declare (an `unknown` type would be dropped on the next
      // sanitize pass, losing the value).
      const subBlockDef = getBlock(block.type)?.subBlocks.find((sb) => sb.id === configKey)
      block.subBlocks[configKey] = {
        id: configKey,
        type: subBlockDef?.type || 'short-input',
        value: configValue,
      }
    }
  })
}

/**
 * Drops the tool entries a `tool_entry` gate of `BLOCK_GATES` refuses, recording each refusal.
 */
export function filterDisallowedTools(
  tools: any[],
  permissionConfig: PermissionGroupConfig | null,
  blockId: string,
  skippedItems: SkippedItem[]
): any[] {
  const { kept, refused } = partitionToolEntries(tools, blockId, { permissionConfig })
  for (const item of refused) logSkippedItem(skippedItems, item)
  return kept
}

/**
 * The value a `tool-input` field is written with: an agent's `tools` normalized, and in every such
 * field (a human in the loop's `notification` as well) the entries a tool-entry gate refuses
 * dropped. Any other field keeps `sanitizedValue`.
 */
export function gateToolInputValue(
  input: {
    blockId: string
    blockType: string
    key: string
    value: unknown
    sanitizedValue: unknown
  },
  permissionConfig: PermissionGroupConfig | null,
  skippedItems: SkippedItem[]
): unknown {
  const { blockId, blockType, key, value, sanitizedValue } = input
  if (!Array.isArray(value) || !isToolInputField(blockType, key)) return sanitizedValue
  const entries = key === 'tools' ? normalizeTools(value) : sanitizedValue
  if (!Array.isArray(entries)) return sanitizedValue
  return filterDisallowedTools(entries, permissionConfig, blockId, skippedItems)
}

/** Decides whether one subBlock input may be written. Records its own skips. */
export type SubBlockInputGate = (key: string, value: unknown) => boolean

/** Shared allow-everything gate, so the unrestricted case allocates nothing. */
const ALLOW_ALL_INPUTS: SubBlockInputGate = () => true

export interface SubBlockInputGateContext {
  blockType: string
  permissionConfig: PermissionGroupConfig | null | undefined
  blockId: string
  operationType: string
  skippedItems: SkippedItem[]
}

/**
 * Builds the gate for one block's subBlock writes from the `field` gates of `BLOCK_GATES`.
 *
 * A denied value is dropped from the write and reported rather than failing the whole operation,
 * matching {@link filterDisallowedTools}: the block still lands, and the model reads the skip
 * reason and picks a value it may use. An edit therefore leaves whatever the block already had,
 * never clearing a value the caller is allowed to keep.
 *
 * Built once per block rather than per input so a denylist is indexed once, and so every path that
 * writes subBlocks, including the trigger-config fan-out that never passes through input
 * validation, shares one gate.
 */
export function createSubBlockInputGate(context: SubBlockInputGateContext): SubBlockInputGate {
  const { blockType, permissionConfig, blockId, operationType, skippedItems } = context
  const check = createFieldValueGate(
    { blockId, blockType, operationType },
    { permissionConfig: permissionConfig ?? null }
  )
  return (key: string, value: unknown) => {
    const refusal = check(key, value)
    if (!refusal) return true
    logSkippedItem(skippedItems, refusal)
    return false
  }
}

/**
 * Normalizes block IDs in operations to ensure they are valid UUIDs.
 * The LLM may generate human-readable IDs like "web_search" or "research_agent"
 * which need to be converted to proper UUIDs for database compatibility.
 *
 * Returns the normalized operations and a mapping from old IDs to new UUIDs.
 */
export function normalizeBlockIdsInOperations(operations: EditWorkflowOperation[]): {
  normalizedOperations: EditWorkflowOperation[]
  idMapping: Map<string, string>
} {
  const logger = createLogger('EditWorkflowServerTool')
  const idMapping = new Map<string, string>()

  // First pass: collect all non-UUID block_ids from add/insert operations
  for (const op of operations) {
    if (op.operation_type === 'add' || op.operation_type === 'insert_into_subflow') {
      if (op.block_id && !isValidUuid(op.block_id)) {
        const newId = generateId()
        idMapping.set(op.block_id, newId)
        logger.debug('Normalizing block ID', { oldId: op.block_id, newId })
      }
    }
  }

  if (idMapping.size === 0) {
    return { normalizedOperations: operations, idMapping }
  }

  logger.info('Normalizing block IDs in operations', {
    normalizedCount: idMapping.size,
    mappings: Object.fromEntries(idMapping),
  })

  // Helper to replace an ID if it's in the mapping
  const replaceId = (id: string | undefined): string | undefined => {
    if (!id) return id
    return idMapping.get(id) ?? id
  }

  // Second pass: update all references to use new UUIDs
  const normalizedOperations = operations.map((op) => {
    const normalized: EditWorkflowOperation = {
      ...op,
      block_id: replaceId(op.block_id) ?? op.block_id,
    }

    if (op.params) {
      normalized.params = { ...op.params }

      // Update subflowId references (for insert_into_subflow)
      if (normalized.params.subflowId) {
        normalized.params.subflowId = replaceId(normalized.params.subflowId)
      }

      if (typeof normalized.params.parentId === 'string') {
        normalized.params.parentId = replaceId(normalized.params.parentId)
      }

      // Update connection references
      if (normalized.params.connections) {
        const normalizedConnections: Record<string, any> = {}
        for (const [handle, targets] of Object.entries(normalized.params.connections)) {
          if (typeof targets === 'string') {
            normalizedConnections[handle] = replaceId(targets)
          } else if (Array.isArray(targets)) {
            normalizedConnections[handle] = targets.map((t) => {
              if (typeof t === 'string') return replaceId(t)
              if (t && typeof t === 'object' && t.block) {
                return { ...t, block: replaceId(t.block) }
              }
              return t
            })
          } else if (targets && typeof targets === 'object' && (targets as any).block) {
            normalizedConnections[handle] = { ...targets, block: replaceId((targets as any).block) }
          } else {
            normalizedConnections[handle] = targets
          }
        }
        normalized.params.connections = normalizedConnections
      }

      // Update nestedNodes block IDs
      if (normalized.params.nestedNodes) {
        const normalizedNestedNodes: Record<string, any> = {}
        for (const [childId, childBlock] of Object.entries(normalized.params.nestedNodes)) {
          const newChildId = replaceId(childId) ?? childId
          normalizedNestedNodes[newChildId] = childBlock
        }
        normalized.params.nestedNodes = normalizedNestedNodes
      }
    }

    return normalized
  })

  return { normalizedOperations, idMapping }
}
