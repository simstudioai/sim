import { isContainerType } from '@/lib/workflows/autolayout'
import {
  type BlockDiffStatus,
  type ContainerConfigField,
  summaryHasChanges,
  type WorkflowDiffSummary,
} from '@/lib/workflows/comparison'
import { formatValueForDisplay } from '@/lib/workflows/comparison/resolve-values'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

/** How a changed value should be rendered in the change list. */
type ValueKind = 'text' | 'scalar' | 'json' | 'secret' | 'toggle' | 'messages' | 'list'

/** Sub-block types whose values read as prose or code, so they get a line diff. */
const TEXT_SUB_BLOCK_TYPES = new Set<string>([
  'long-input',
  'code',
  'condition-input',
  'text',
  'eval-input',
  'messages-input',
])

const INLINE_TEXT_MAX_LENGTH = 60

/**
 * Sub-block types whose values are lists of identifiable items, diffed item by
 * item. A value that turns out not to be a list (a checkbox group persists a
 * record of option flags) falls back to the shape-based rules.
 */
const LIST_SUB_BLOCK_TYPES = new Set<string>([
  'tool-input',
  'skill-input',
  'condition-input',
  'router-input',
  'input-format',
  'checkbox-list',
  'grouped-checkbox-list',
  'variables-input',
])

/** Reads a stored list value, tolerating the JSON-string form some fields persist. */
export function toItemList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

/** Lists whose items are ordered branches: a rewritten item pairs by position, not identity. */
export function isPositionalListField(blockType: string, field: string): boolean {
  const type = findSubBlockConfig(blockType, field)?.type
  return type === 'condition-input' || type === 'router-input'
}

/** How one list item is identified, named, and compared. */
export interface ListItemView {
  key: string
  label: string
  /** The item's comparable body; a change here renders as a text diff */
  text: string
}

export type ListRowKind = 'added' | 'removed' | 'changed'

/** One row of an item-by-item list diff. */
export interface ListDiffRow {
  kind: ListRowKind
  label: string
  /** The item's previous label when only its position or name changed */
  oldLabel?: string
  oldText: string
  newText: string
}

/**
 * Pairs items across the two sides: by key first, then by identical body for
 * items whose keys differ (a route or condition re-created with a fresh id is
 * still the same route), and finally by position so a rewritten item reads as
 * changed rather than as a removal plus an addition.
 */
export function pairListItems(
  oldItems: ListItemView[],
  newItems: ListItemView[],
  positional: boolean
): ListDiffRow[] {
  const rows: ListDiffRow[] = []
  const oldLeft = [...oldItems]
  const newLeft = [...newItems]

  const take = (
    list: ListItemView[],
    predicate: (item: ListItemView) => boolean
  ): ListItemView | undefined => {
    const index = list.findIndex(predicate)
    return index === -1 ? undefined : list.splice(index, 1)[0]
  }
  const same = (a: ListItemView, b: ListItemView) => a.text === b.text && a.label === b.label

  for (const item of newItems) {
    const previous = take(oldLeft, (candidate) => candidate.key === item.key)
    if (!previous) continue
    take(newLeft, (candidate) => candidate === item)
    if (!same(previous, item)) {
      rows.push({
        kind: 'changed',
        label: item.label,
        oldLabel: previous.label !== item.label ? previous.label : undefined,
        oldText: previous.text,
        newText: item.text,
      })
    }
  }
  for (const item of [...newLeft]) {
    const previous = take(oldLeft, (candidate) => same(candidate, item))
    if (previous) take(newLeft, (candidate) => candidate === item)
  }
  while (positional && newLeft.length && oldLeft.length) {
    const item = newLeft.shift()!
    const previous = oldLeft.shift()!
    rows.push({ kind: 'changed', label: item.label, oldText: previous.text, newText: item.text })
  }
  for (const item of newLeft) {
    rows.push({ kind: 'added', label: item.label, oldText: '', newText: item.text })
  }
  for (const item of oldLeft) {
    rows.push({ kind: 'removed', label: item.label, oldText: item.text, newText: '' })
  }
  return rows
}

/** Tool item fields, beyond its params, that change what the tool may do or how it runs. */
const TOOL_EXECUTION_FIELDS = [
  'operation',
  'usageControl',
  'usageControlExpression',
  'operationPolicy',
  'code',
  'schema',
] as const

function pick(item: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) if (key in item) out[key] = item[key]
  return out
}

function filterBlank(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) if (!isBlankValue(value)) out[key] = value
  return out
}

function readString(item: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value) return value
  }
  return undefined
}

/**
 * Projects a list item to key, label and body according to the field it lives
 * in. Conditions and routes are positional ("if", "else if", "Route 2") since
 * their ids are opaque; everything else names itself.
 */
export function describeListItems(
  blockType: string,
  field: string,
  items: unknown[]
): ListItemView[] {
  const config = findSubBlockConfig(blockType, field)
  const type = config?.type
  return items.map((raw, index) => {
    if (raw === null || typeof raw !== 'object') {
      const text = String(raw)
      return { key: text, label: text, text: '' }
    }
    const item = raw as Record<string, unknown>
    const id = readString(item, ['id', 'toolId', 'name'])
    if (type === 'condition-input') {
      const label = index === 0 ? 'if' : index === items.length - 1 ? 'else' : 'else if'
      return { key: id ?? `cond-${index}`, label, text: readString(item, ['value']) ?? '' }
    }
    if (type === 'router-input') {
      return {
        key: id ?? `route-${index}`,
        label: `Route ${index + 1}`,
        text: readString(item, ['value']) ?? '',
      }
    }
    if (type === 'tool-input') {
      const params = item.params
      const paramRecord =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
      const toolType = readString(item, ['type'])
      /* MCP tools name themselves by server tool; custom tools by their saved id or function name. */
      const mcpName = toolType === 'mcp' ? readString(paramRecord, ['toolName']) : undefined
      const customName =
        toolType === 'custom-tool'
          ? (readString(item, ['customToolId', 'title']) ??
            readString(
              ((item.schema as { function?: Record<string, unknown> } | undefined)?.function ??
                {}) as Record<string, unknown>,
              ['name']
            ))
          : undefined
      const { serverId, toolName: _toolName, ...rawParams } = paramRecord
      const visibleParams = maskSecretsDeep(rawParams) as Record<string, unknown>
      /* What the tool is allowed to do, where it runs and how it runs matter as much as its params. */
      const body = filterBlank({
        ...(maskSecretsDeep(pick(item, TOOL_EXECUTION_FIELDS)) as Record<string, unknown>),
        server: serverId,
        params: Object.keys(visibleParams).length ? visibleParams : undefined,
      })
      return {
        key:
          mcpName ?? customName ?? readString(item, ['toolId', 'type', 'title']) ?? `tool-${index}`,
        label:
          mcpName ??
          readString(item, ['title']) ??
          customName ??
          readString(item, ['type']) ??
          `Tool ${index + 1}`,
        text: Object.keys(body).length ? JSON.stringify(body, null, 2) : '',
      }
    }
    if (type === 'input-format') {
      const name = readString(item, ['name']) ?? `Field ${index + 1}`
      const fieldType = readString(item, ['type'])
      const description = readString(item, ['description'])
      const defaultValue = isBlankValue(item.value)
        ? undefined
        : `default ${toDiffText(item.value)}`
      return {
        key: id ?? name,
        label: name,
        text: [fieldType, description, defaultValue].filter(Boolean).join(' · '),
      }
    }
    const label = readString(item, ['title', 'name', 'label', 'id']) ?? `Item ${index + 1}`
    const { id: _id, title: _title, name: _name, label: _label, ...rest } = item
    return {
      key: id ?? label,
      label,
      text: Object.keys(rest).length ? JSON.stringify(maskSecretsDeep(rest), null, 2) : '',
    }
  })
}

/**
 * Sub-block types whose value names something that lives in a workspace rather
 * than in the workflow's logic: a credential, a picked resource, a trigger path.
 * Two environments differ on these by design, so a fork comparison sets them
 * apart from prompt and logic changes.
 */
const ENVIRONMENT_BOUND_TYPES = new Set<string>([
  'oauth-input',
  'webhook-config',
  'file-selector',
  'sheet-selector',
  'project-selector',
  'channel-selector',
  'user-selector',
  'folder-selector',
  'knowledge-base-selector',
  'document-selector',
  'mcp-server-selector',
  'mcp-tool-selector',
  'table-selector',
  'workflow-selector',
])

const ENVIRONMENT_BOUND_FIELDS = new Set<string>([
  'apiKey',
  'credential',
  'triggerPath',
  'webhookPath',
])

function isEnvironmentBinding(blockType: string, field: string): boolean {
  if (ENVIRONMENT_BOUND_FIELDS.has(field)) return true
  const config = findSubBlockConfig(blockType, field)
  if (!config) return false
  return Boolean(config.password) || ENVIRONMENT_BOUND_TYPES.has(config.type)
}

/** Splits a block's changes into logic rows and workspace-bound rows. */
export function splitEnvironmentBindings<T extends { field: string }>(
  blockType: string,
  changes: T[]
): { logic: T[]; bindings: T[] } {
  const logic: T[] = []
  const bindings: T[] = []
  for (const change of changes) {
    ;(isEnvironmentBinding(blockType, change.field) ? bindings : logic).push(change)
  }
  return { logic, bindings }
}

/** Labels for container configuration fields, which no block definition declares. */
const CONTAINER_FIELD_LABELS: Record<ContainerConfigField, string> = {
  loopType: 'Loop type',
  iterations: 'Iterations',
  forEachItems: 'Collection',
  whileCondition: 'While condition',
  doWhileCondition: 'Do-while condition',
  parallelType: 'Parallel type',
  count: 'Count',
  distribution: 'Collection',
}

export function containerFieldLabel(field: string): string {
  return Object.hasOwn(CONTAINER_FIELD_LABELS, field)
    ? CONTAINER_FIELD_LABELS[field as ContainerConfigField]
    : field
}

/**
 * Labels for fields the comparison engine reports outside any block
 * definition: block-level settings and the editor's basic/advanced mode per
 * canonical parameter, which decides which of two stored values executes.
 */
export const ENGINE_FIELD_LABELS: Record<string, string> = {
  'data.canonicalModes': 'Field modes',
  name: 'Name',
  enabled: 'Enabled',
  triggerMode: 'Trigger mode',
  advancedMode: 'Advanced mode',
}

/** A chat message as an agent block stores it. */
interface DiffMessage {
  role: string
  content: string
}

function isMessageList(value: unknown): value is DiffMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as DiffMessage).role === 'string' &&
        typeof (item as DiffMessage).content === 'string'
    )
  )
}

/** Reads a stored messages value as a list, tolerating the JSON-string form older drafts used. */
export function toMessageList(value: unknown): DiffMessage[] {
  if (isMessageList(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (isMessageList(parsed)) return parsed
    } catch {
      return []
    }
  }
  return []
}

/**
 * Each block definition's sub-blocks are indexed once, keyed by the definition
 * object itself so a re-registered definition (custom blocks, tests) is never
 * served from a stale index.
 */
const subBlockIndex = new WeakMap<BlockConfig, Map<string, SubBlockConfig>>()

function findSubBlockConfig(blockType: string, field: string): SubBlockConfig | undefined {
  const config = getBlock(blockType)
  if (!config) return undefined
  let index = subBlockIndex.get(config)
  if (!index) {
    index = new Map()
    for (const subBlock of config.subBlocks ?? []) {
      if (!index.has(subBlock.id)) index.set(subBlock.id, subBlock)
    }
    subBlockIndex.set(config, index)
  }
  return index.get(field)
}

function isTextLike(value: unknown): boolean {
  return (
    typeof value === 'string' && (value.includes('\n') || value.length > INLINE_TEXT_MAX_LENGTH)
  )
}

/** A short single-token value (model id, number, enum) reads better as a pair than a word diff. */
export function isSentenceLike(value: unknown): value is string {
  return typeof value === 'string' && /\s/.test(value.trim())
}

/** Field rows in the order the block definition declares them; unknown fields trail. */
function sortChangesByDefinition<T extends { field: string }>(
  blockType: string,
  changes: T[]
): T[] {
  const order = new Map<string, number>()
  getBlock(blockType)?.subBlocks.forEach((subBlock, index) => order.set(subBlock.id, index))
  const rank = (field: string) => order.get(field) ?? Number.MAX_SAFE_INTEGER
  return [...changes].sort((a, b) => rank(a.field) - rank(b.field))
}

/**
 * Picks the row treatment for a field change from the block definition first
 * and the value shapes second, so a prompt reads as a text diff even when the
 * definition no longer declares the field.
 */
export function classifyChange(
  blockType: string,
  field: string,
  oldValue: unknown,
  newValue: unknown
): ValueKind {
  const config = findSubBlockConfig(blockType, field)
  /* A definition this viewer cannot resolve (a source-side custom block, a retired block) still hides secrets by name. */
  if (config?.password || (!config && isSecretKey(field))) return 'secret'
  if (config?.type === 'messages-input' || isMessageList(oldValue) || isMessageList(newValue)) {
    return 'messages'
  }
  const oldList = toItemList(oldValue)
  const newList = toItemList(newValue)
  const eitherList = oldList !== null || newList !== null
  const bothListOrBlank =
    (oldList !== null || isBlankValue(oldValue)) && (newList !== null || isBlankValue(newValue))
  if (bothListOrBlank && ((config && LIST_SUB_BLOCK_TYPES.has(config.type)) || eitherList)) {
    return 'list'
  }
  if (config && TEXT_SUB_BLOCK_TYPES.has(config.type)) return 'text'
  if (typeof oldValue === 'boolean' || typeof newValue === 'boolean') return 'toggle'
  if (isTextLike(oldValue) || isTextLike(newValue)) return 'text'
  const sample = newValue ?? oldValue
  if (sample !== null && typeof sample === 'object') return 'json'
  return 'scalar'
}

/**
 * Resolves a stored dropdown id to its option label, else falls back to the
 * shared display formatter.
 */
export function formatScalar(blockType: string, field: string, value: unknown): string {
  const config = findSubBlockConfig(blockType, field)
  if (config?.type === 'dropdown' && typeof value === 'string' && config.options) {
    const options = typeof config.options === 'function' ? config.options() : config.options
    const match = options.find((option) => option.id === value)
    if (match?.label) return match.label
  }
  return formatValueForDisplay(value)
}

/**
 * A string for the line diff; objects are pretty-printed, with secret-looking
 * leaves masked, so structure diffs line by line.
 */
export function toDiffText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(maskSecretsDeep(value), null, 2)
}

/** One side of a block that only exists in one version: what it has, as a change from nothing. */
interface OneSidedField {
  field: string
  oldValue: unknown
  newValue: unknown
}

/**
 * Keys whose values are never rendered, wherever they appear in a stored value:
 * anchored to the end of the key so `maxTokens` and `tokenLimit` stay visible
 * while `accessToken`, `client_secret`, `apiKey` and an `Authorization` header
 * are masked.
 */
const SECRET_KEY_PATTERN =
  /^(auth|authorization|bearer|cookie|pwd)$|(token|secret|password|passphrase|credential|api[_-]?key|private[_-]?key|authorization)$/i
const MASKED_VALUE = '•••'

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key.trim())
}

/**
 * Returns a copy of a stored value with every secret-looking leaf masked, at any
 * depth: object keys, and the `Value` of a key/value table row whose `Key`
 * names a secret (an API block's headers).
 */
export function maskSecretsDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecretsDeep)
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const cells = record.cells
  if (cells && typeof cells === 'object' && !Array.isArray(cells)) {
    const row = cells as Record<string, unknown>
    if (
      typeof row.Key === 'string' &&
      isSecretKey(row.Key) &&
      row.Value !== '' &&
      row.Value != null
    ) {
      return { ...record, cells: { ...row, Value: MASKED_VALUE } }
    }
  }
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(record)) {
    out[key] =
      isSecretKey(key) && entry !== '' && entry != null ? MASKED_VALUE : maskSecretsDeep(entry)
  }
  return out
}

export function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

/**
 * Every non-empty field on a block that exists on only one side, as field
 * changes with the other side empty. An added block then renders exactly like
 * a modified one whose every field went from nothing to its value, and a
 * removed block the reverse, so code stays code and a prompt stays a prompt.
 * Declared fields come first in definition order; a declared secret is kept
 * so the card can say it is set, an undeclared secret-looking key is dropped
 * because nothing would mask its raw value.
 */
export function listOneSidedFields(block: BlockState, side: 'added' | 'removed'): OneSidedField[] {
  const declared = getBlock(block.type)?.subBlocks ?? []
  const out: OneSidedField[] = []
  const seen = new Set<string>()
  const push = (field: string, value: unknown) => {
    if (seen.has(field)) return
    seen.add(field)
    if (isBlankValue(value)) return
    out.push({
      field,
      oldValue: side === 'removed' ? value : undefined,
      newValue: side === 'added' ? value : undefined,
    })
  }
  for (const subBlock of declared) push(subBlock.id, block.subBlocks?.[subBlock.id]?.value)
  for (const [field, state] of Object.entries(block.subBlocks ?? {})) {
    if (isSecretKey(field)) continue
    push(field, state?.value)
  }
  return out
}

/**
 * Fields the comparison engine counts but a reviewer never needs to see: pure
 * canvas presentation. They still drive "needs redeploy", so they are hidden
 * here rather than in the engine. The basic/advanced mode memory is NOT one of
 * them: with both values stored, the mode decides which one executes.
 */
const PRESENTATION_FIELDS = new Set(['horizontalHandles'])

/**
 * The summary with presentation-only field changes removed, and any block that
 * only had those dropped from the modified list, so the canvas and the list
 * agree on what counts as a change.
 */
export function omitPresentationChanges(summary: WorkflowDiffSummary): WorkflowDiffSummary {
  const modifiedBlocks = summary.modifiedBlocks
    .map((block) => ({
      ...block,
      changes: block.changes.filter(
        (change) => !PRESENTATION_FIELDS.has(change.field) && !change.field.endsWith('.properties')
      ),
    }))
    .filter((block) => block.changes.length > 0)
  const next = { ...summary, modifiedBlocks }
  next.hasChanges = summaryHasChanges(next)
  return next
}

/** One block listed under a container's "Blocks inside". */
export interface MembershipRow {
  name: string
  /** The block exists on both sides and changed container, rather than being added or removed */
  moved: boolean
}

/** A block that moved between containers, named for the row "Moved into X". */
export interface BlockMove {
  into?: string
  outOf?: string
}

/** One block entry in the change list. */
export interface BlockChangeEntry {
  id: string
  type: string
  name: string
  status: BlockDiffStatus
  changes: WorkflowDiffSummary['modifiedBlocks'][number]['changes']
  /** Set on a surviving block whose container changed */
  moved?: BlockMove
  /** Set on a container: which blocks entered or left it; `moved` marks a block that survives elsewhere */
  membership?: { added: MembershipRow[]; removed: MembershipRow[] }
  /** Blocks nested under an added or removed container, listed with it */
  children: BlockChangeEntry[]
}

function blockName(blocks: Record<string, BlockState>, id: string): string {
  const block = blocks[id]
  return block?.name || block?.type || id
}

function parentOf(block: BlockState | undefined): string | undefined {
  const parentId = block?.data?.parentId
  return typeof parentId === 'string' && parentId ? parentId : undefined
}

/** Every block's children in one pass, so containers look their members up in O(1). */
function childrenByParent(blocks: Record<string, BlockState>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [id, block] of Object.entries(blocks)) {
    const parentId = parentOf(block)
    if (!parentId) continue
    const list = out.get(parentId)
    if (list) list.push(id)
    else out.set(parentId, [id])
  }
  return out
}

/**
 * Flattens the summary into list entries: modified blocks first because they
 * carry the field rows a reviewer spends the longest on, then added, then
 * removed. A surviving block whose container changed reads as modified with a
 * "Moved" row; a container that changed configuration or membership reads as
 * modified with its config rows and the blocks that entered or left; children
 * of an added or removed container nest under it.
 */
export function listBlockChanges(
  summary: WorkflowDiffSummary,
  baseBlocks: Record<string, BlockState>,
  targetBlocks: Record<string, BlockState>
): BlockChangeEntry[] {
  const blocks = { ...baseBlocks, ...targetBlocks }
  const modified = new Map<string, BlockChangeEntry>()
  for (const block of summary.modifiedBlocks) {
    modified.set(block.id, {
      id: block.id,
      type: block.type,
      name: block.name || block.type,
      status: 'modified',
      changes: sortChangesByDefinition(block.type, block.changes),
      children: [],
    })
  }

  const added = new Set(summary.addedBlocks.map((block) => block.id))
  const removed = new Set(summary.removedBlocks.map((block) => block.id))
  const ensureModified = (id: string): BlockChangeEntry => {
    let entry = modified.get(id)
    if (!entry) {
      entry = {
        id,
        type: blocks[id]?.type ?? 'unknown',
        name: blockName(blocks, id),
        status: 'modified',
        changes: [],
        children: [],
      }
      modified.set(id, entry)
    }
    return entry
  }

  /* A block on both sides whose parent changed moved, whatever became of the containers. */
  for (const id of Object.keys(targetBlocks)) {
    if (!baseBlocks[id]) continue
    const before = parentOf(baseBlocks[id])
    const after = parentOf(targetBlocks[id])
    if (before === after) continue
    const entry = ensureModified(id)
    entry.moved = {
      ...(after ? { into: blockName(blocks, after) } : {}),
      ...(before ? { outOf: blockName(blocks, before) } : {}),
    }
  }

  for (const container of summary.containerChanges) {
    if (added.has(container.id) || removed.has(container.id)) continue
    const entry = ensureModified(container.id)
    const seen = new Set(entry.changes.map((change) => change.field))
    entry.changes = [
      ...entry.changes,
      ...container.changes.filter((change) => !seen.has(change.field)),
    ]
    if (container.nodesAdded.length || container.nodesRemoved.length) {
      const row = (id: string): MembershipRow => ({
        name: blockName(blocks, id),
        moved: Boolean(baseBlocks[id] && targetBlocks[id]),
      })
      entry.membership = {
        added: container.nodesAdded.map(row),
        removed: container.nodesRemoved.map(row),
      }
    }
  }

  const nest = (
    list: WorkflowDiffSummary['addedBlocks'],
    status: 'added' | 'removed',
    sameStatus: Set<string>,
    side: Record<string, BlockState>
  ): BlockChangeEntry[] => {
    const entries = new Map<string, BlockChangeEntry>()
    const children = childrenByParent(side)
    for (const block of list) {
      entries.set(block.id, {
        id: block.id,
        type: block.type,
        name: block.name || block.type,
        status,
        changes: [],
        children: [],
      })
    }
    const roots: BlockChangeEntry[] = []
    for (const entry of entries.values()) {
      const parentId = parentOf(side[entry.id])
      const parent = parentId && sameStatus.has(parentId) ? entries.get(parentId) : undefined
      if (parent) parent.children.push(entry)
      else roots.push(entry)
      /* A container that appeared or vanished around surviving blocks lists them too. */
      if (isContainerType(entry.type)) {
        const survivors = (children.get(entry.id) ?? []).filter((id) => !sameStatus.has(id))
        if (survivors.length) {
          const rows = survivors.map((id) => ({ name: blockName(blocks, id), moved: true }))
          entry.membership = {
            added: status === 'added' ? rows : [],
            removed: status === 'removed' ? rows : [],
          }
        }
      }
    }
    return roots
  }

  return [
    ...modified.values(),
    ...nest(summary.addedBlocks, 'added', added, targetBlocks),
    ...nest(summary.removedBlocks, 'removed', removed, baseBlocks),
  ]
}
