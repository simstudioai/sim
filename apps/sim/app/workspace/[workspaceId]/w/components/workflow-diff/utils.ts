import {
  collectErrorSourceBlockIds,
  resolveEffectiveErrorEnabled,
} from '@sim/workflow-types/workflow'
import { isContainerType } from '@/lib/workflows/autolayout'
import { shapeSubBlockValue } from '@/lib/workflows/canonical/subblock-value'
import {
  type BlockDiffStatus,
  type ContainerConfigField,
  containerConfigFields,
  type WorkflowDiffSummary,
} from '@/lib/workflows/comparison'
import { isPresentationField } from '@/lib/workflows/comparison/compare'
import {
  extractBlockFieldsForComparison,
  filterSubBlockIds,
  normalizeValue,
} from '@/lib/workflows/comparison/normalize'
import { formatValueForDisplay } from '@/lib/workflows/comparison/resolve-values'
import { resolveDropdownLabel } from '@/lib/workflows/subblocks/display'
import { getSubBlockPresentationKind } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/value-presentation'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

/** How a changed value should be rendered in the change list. */
type ValueKind = 'text' | 'scalar' | 'json' | 'secret' | 'toggle' | 'structured'

const INLINE_TEXT_MAX_LENGTH = 60

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

export function findSubBlockConfig(
  blockType: string | undefined,
  field: string
): SubBlockConfig | undefined {
  return blockType
    ? getBlock(blockType)?.subBlocks.find((config) => config.id === field)
    : undefined
}

function isSensitiveField(blockType: string | undefined, field: string): boolean {
  const configs = blockType
    ? getBlock(blockType)?.subBlocks.filter((config) => config.id === field)
    : undefined
  return configs?.length
    ? configs.some((config) => config.password || config.type === 'oauth-input')
    : isSecretKey(field)
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
function sortChangesByDefinition<T extends { field: string; scope?: string }>(
  blockType: string,
  changes: T[]
): T[] {
  const order = new Map<string, number>()
  getBlock(blockType)?.subBlocks.forEach((subBlock, index) => order.set(subBlock.id, index))
  const rank = (field: string) => order.get(field) ?? Number.MAX_SAFE_INTEGER
  return [...changes].sort(
    (a, b) =>
      (a.scope === 'block' ? Number.MAX_SAFE_INTEGER : rank(a.field)) -
      (b.scope === 'block' ? Number.MAX_SAFE_INTEGER : rank(b.field))
  )
}

/**
 * Picks the row treatment for a field change from the block definition first
 * and the value shapes second, so a prompt reads as a text diff even when the
 * definition no longer declares the field.
 */
export function classifyChange(
  blockType: string | undefined,
  field: string,
  oldValue: unknown,
  newValue: unknown
): ValueKind {
  const config = findSubBlockConfig(blockType, field)
  if (config?.type === 'table') return 'structured'
  if (isSensitiveField(blockType, field)) return 'secret'
  const presentation = getSubBlockPresentationKind(config?.type, oldValue, newValue)
  if (presentation === 'structured') return 'structured'
  if (presentation === 'secret') return 'secret'
  if ([oldValue, newValue].some((value) => value !== null && typeof value === 'object'))
    return 'json'
  if (oldValue != null && newValue != null && typeof oldValue !== typeof newValue) return 'json'
  if (presentation === 'text') return 'text'
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
export function formatScalar(
  blockType: string | undefined,
  field: string,
  value: unknown,
  values: Record<string, unknown> = {}
): string {
  const config = findSubBlockConfig(blockType, field)
  const optionLabel = typeof value === 'string' ? resolveDropdownLabel(config, value, values) : null
  if (optionLabel) return optionLabel
  /* A comparison must show the whole value: a difference at character 55 is still a difference. */
  if (typeof value === 'string') return maskEncodedSecrets(value) || formatValueForDisplay(value)
  return formatValueForDisplay(maskSecretsDeep(value))
}

/**
 * A string for the line diff; objects are pretty-printed, with secret-looking
 * leaves masked, so structure diffs line by line.
 */
export function toDiffText(value: unknown, blockType?: string, field?: string): string {
  if (value === null || value === undefined) return ''
  const config = blockType && field ? findSubBlockConfig(blockType, field) : undefined
  const shaped = field ? shapeSubBlockValue(field, value, config?.type) : value
  const masked = maskSecretsDeep(shaped)
  return typeof masked === 'string' ? masked : JSON.stringify(normalizeValue(masked), null, 2)
}

/** One side of a block that only exists in one version: what it has, as a change from nothing. */
interface OneSidedField {
  scope: 'block' | 'subblock'
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
  /^(auth|authorization|bearer|cookie|pwd)$|(token|secret|password|passphrase|credential|api[ _-]?key|private[ _-]?key|authorization)$/i
/**
 * Words that make a key secret wherever they sit in it: `secretAccessKey`,
 * `aws_secret_access_key`, `passwordHash`. `credential` is not one of them, so
 * `credentialId` (a reference, not a secret) stays readable.
 */
const SECRET_WORDS = new Set(['secret', 'password', 'passphrase', 'passwd', 'pwd'])
const MASKED_VALUE = '•••'

/** Splits `awsSecretAccessKey`, `client-secret` and `API_KEY` into lowercase words. */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

function isSecretKey(key: string): boolean {
  const trimmed = key.trim()
  return (
    SECRET_KEY_PATTERN.test(trimmed) || keyWords(trimmed).some((word) => SECRET_WORDS.has(word))
  )
}

/**
 * Tool params persist structured values as JSON strings, so a header map with
 * an Authorization entry arrives encoded; decode, mask and re-encode it.
 */
function maskEncodedSecrets(value: string, blockType?: string): string {
  const trimmed = value.trimStart()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return value
  }
  if (parsed === null || typeof parsed !== 'object') return value
  const masked = maskSecretsDeep(parsed, blockType)
  return JSON.stringify(masked) === JSON.stringify(parsed) ? value : JSON.stringify(masked)
}

/**
 * Returns a copy of a stored value with every secret-looking leaf masked, at any
 * depth: object keys, and the `Value` of a key/value table row whose `Key`
 * names a secret (an API block's headers).
 */
export function maskSecretsDeep(value: unknown, blockType?: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => maskSecretsDeep(entry))
  if (typeof value === 'string') return maskEncodedSecrets(value, blockType)
  if (value === null || typeof value !== 'object') return value
  let record = value as Record<string, unknown>
  const cells = record.cells
  if (cells && typeof cells === 'object' && !Array.isArray(cells)) {
    const row = cells as Record<string, unknown>
    const name = row.Key ?? row.Field
    if (typeof name === 'string' && isSecretKey(name) && row.Value !== '' && row.Value != null) {
      record = { ...record, cells: { ...row, Value: MASKED_VALUE } }
    }
  }
  const out: Record<string, unknown> = Object.create(null)
  for (const [key, entry] of Object.entries(record)) {
    out[key] =
      isSensitiveField(blockType, key) && entry !== '' && entry != null
        ? MASKED_VALUE
        : maskSecretsDeep(
            entry,
            key === 'params' && typeof record.type === 'string' ? record.type : undefined
          )
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
export function listOneSidedFields(
  block: BlockState,
  side: 'added' | 'removed',
  errorSources: ReadonlySet<string> = new Set()
): OneSidedField[] {
  const declared = getBlock(block.type)?.subBlocks ?? []
  const fields = new Set(filterSubBlockIds(Object.keys(block.subBlocks ?? {})))
  const out: OneSidedField[] = []
  const seen = new Set<string>()
  const push = (field: string, value: unknown, scope: 'block' | 'subblock' = 'subblock') => {
    const key = `${scope}:${field}`
    if ((scope === 'subblock' && !fields.has(field)) || seen.has(key)) return
    seen.add(key)
    if (isBlankValue(value)) return
    out.push({
      scope,
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
  const { blockRest, normalizedData } = extractBlockFieldsForComparison(block)
  const settings = {
    ...blockRest,
    errorEnabled: resolveEffectiveErrorEnabled(block, block.id, errorSources),
  }
  const defaults: Record<string, unknown> = {
    enabled: true,
    errorEnabled: false,
    advancedMode: false,
    triggerMode: false,
  }
  for (const [field, value] of Object.entries(settings)) {
    if (['id', 'type', 'name', 'data'].includes(field) || isPresentationField(field)) continue
    if (Object.hasOwn(defaults, field) && (value ?? defaults[field]) === defaults[field]) continue
    push(field, value, 'block')
  }
  for (const [field, value] of Object.entries(normalizedData)) {
    if (!isPresentationField(`data.${field}`)) push(`data.${field}`, value, 'block')
  }

  return out
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
  changes: Array<
    | WorkflowDiffSummary['modifiedBlocks'][number]['changes'][number]
    | (WorkflowDiffSummary['containerChanges'][number]['changes'][number] & { scope: 'container' })
  >
  /** Set on a surviving block whose container changed */
  moved?: BlockMove
  /** Set on a container: which blocks entered or left it; `moved` marks a block that survives elsewhere */
  membership?: { added: MembershipRow[]; removed: MembershipRow[] }
  /** Blocks nested under an added or removed container, listed with it */
  children: BlockChangeEntry[]
}

function blockName(blocks: Record<string, BlockState>, id: string): string {
  const block = blocks[id]
  return block?.name || block?.type || 'Unavailable block'
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
  targetBlocks: Record<string, BlockState>,
  /** Each side's loop and parallel configs, so an added or removed container shows what it runs */
  containers?: {
    base: Pick<WorkflowState, 'loops' | 'parallels'>
    target: Pick<WorkflowState, 'loops' | 'parallels'>
  }
): BlockChangeEntry[] {
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
        type: targetBlocks[id]?.type ?? 'unknown',
        name: blockName(targetBlocks, id),
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
      ...(after ? { into: blockName(targetBlocks, after) } : {}),
      ...(before ? { outOf: blockName(baseBlocks, before) } : {}),
    }
  }

  for (const container of summary.containerChanges) {
    if (added.has(container.id) || removed.has(container.id)) continue
    const entry = ensureModified(container.id)
    const seen = new Set(entry.changes.map((change) => `${change.scope}:${change.field}`))
    entry.changes = [
      ...entry.changes,
      ...container.changes
        .filter((change) => !seen.has(`container:${change.field}`))
        .map((change) => ({ ...change, scope: 'container' as const })),
    ]
    if (container.nodesAdded.length || container.nodesRemoved.length) {
      const row = (id: string, side: Record<string, BlockState>): MembershipRow => ({
        name: blockName(side, id),
        moved: Boolean(baseBlocks[id] && targetBlocks[id]),
      })
      entry.membership = {
        added: container.nodesAdded.map((id) => row(id, targetBlocks)),
        removed: container.nodesRemoved.map((id) => row(id, baseBlocks)),
      }
    }
  }

  const nest = (
    list: WorkflowDiffSummary['addedBlocks'],
    status: 'added' | 'removed',
    sameStatus: Set<string>,
    side: Record<string, BlockState>,
    sideContainers: Pick<WorkflowState, 'loops' | 'parallels'> | undefined
  ): BlockChangeEntry[] => {
    const errorSources = collectErrorSourceBlockIds(
      status === 'added' ? summary.edgeChanges.addedDetails : summary.edgeChanges.removedDetails
    )
    const entries = new Map<string, BlockChangeEntry>()
    const children = childrenByParent(side)
    for (const block of list) {
      /* A container's iteration settings live beside its block, not in its sub-blocks. */
      const config =
        sideContainers && isContainerType(block.type)
          ? containerConfigFields(sideContainers, block.id)
          : []
      entries.set(block.id, {
        id: block.id,
        type: block.type,
        name: block.name || block.type,
        status,
        changes: [
          ...config.map(({ field, value }) => ({
            scope: 'container' as const,
            field,
            oldValue: status === 'removed' ? value : null,
            newValue: status === 'added' ? value : null,
          })),
          ...(side[block.id] ? listOneSidedFields(side[block.id], status, errorSources) : []),
        ],
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
          const rows = survivors.map((id) => ({ name: blockName(side, id), moved: true }))
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
    ...nest(summary.addedBlocks, 'added', added, targetBlocks, containers?.target),
    ...nest(summary.removedBlocks, 'removed', removed, baseBlocks, containers?.base),
  ]
}
