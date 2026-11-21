/**
 * `.sim/lock.json`: the committed identity sidecar of a workflow source file. It binds keys to ids
 * so a canvas rename, a drag or a branch reorder never changes identity.
 * Edge ids are never in the lock.
 *
 * The lock holds only environment-independent facts: logical ids, idents, print order, code
 * files and layout. Everything tied to one environment's stored state (workflow, workspace,
 * freshness fingerprint, catalog hash) is the separate {@link SourceBase}: single-workflow `source get/apply`
 * returns and takes it beside the lock, and the CLI keeps it in `.sim/base.json`.
 *
 * Version policy: adding an optional field does not bump `version`. Validators learn a field
 * before writers emit it; until every reader knows a field, data goes under an `x-` key, which
 * every validator tolerates and preserves. Removing or changing the meaning of a field bumps it,
 * and the new format adds its step to {@link upgradeWorkflowLock} or {@link upgradeSourceBase}:
 * every reader goes through them, so a file written in any version this build reads parses as
 * the current one.
 */

import { isRecordLike } from '@sim/utils/object'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import { isIdentifierName } from './code-files/ref-path'
import type { LockDiagnosticCode } from './diagnostics/codes'
import { diagnostic } from './diagnostics/factory'
import type { Diagnostic } from './diagnostics/frame'
import { SOURCE_LIMITS } from './limits'
import type { BlockKey, BranchKey, Json, SubBlockId, VarKey } from './model'
import { SDK_RESERVED_IDENTIFIERS } from './sdk'

/**
 * `sf1:` + lowercase hex SHA-256 (`sourceFingerprint`). Checkouts in the field hold it in their
 * base, so a change to canonicalize's output or to the hashing is a format change: it bumps the
 * prefix (`sf2:`) and accepts the old one for a release. `equivalence/pinned.test.ts` pins it.
 */
export type SourceFingerprint = `sf1:${string}`

/** An extension field: tolerated and preserved by every validator, never interpreted. */
export type LockExtensionKey = `x-${string}`

// Lock and base shapes are type aliases, not interfaces, so they stay assignable to the generated
// API types, which render these open (extension-carrying) objects with a string index signature.

/** Canvas geometry; materialize applies it only to a block the stored graph does not hold. */
export type LockLayout = {
  [extension: LockExtensionKey]: Json
  x: number
  y: number
  w?: number
  h?: number
  /** Stored `block.height`. */
  height?: number
  horizontalHandles?: boolean
}

/**
 * One id-bearing list entry (an inputFormat field). A list, not a name → id map, so duplicate or
 * empty names keep their ids. These ids are cross-workflow foreign keys: custom block subBlock ids
 * are the Start field ids (`assembleCustomBlockInputMapping`).
 */
export type LockItem = {
  name: string
  id: string
}

/**
 * The id-bearing half of a lock block: what canonicalize derives from a stored graph and
 * materialize returns. `sourceFingerprint` hashes exactly this plus the CWM.
 */
export type LockIdentityBlock = {
  id: string
  /** The enclosing container's key, or `null` at the root. */
  parent: BlockKey | null
  /** Branch key → stored row id (condition/router only). */
  branches?: Record<BranchKey, string>
  /** Per subBlock, its id-bearing items in stored order. */
  items?: Record<SubBlockId, LockItem[]>
}

/** The ids of one workflow, keyed the way the CWM is. */
export interface LockIdentity {
  blocks: Record<BlockKey, LockIdentityBlock>
  /** Variable key → variable id. */
  variables: Record<VarKey, string>
}

export type WorkflowLockBlock = LockIdentityBlock & {
  [extension: LockExtensionKey]: Json
  /**
   * The TS `const` identifier the block is printed as. Derived camelCase from
   * the name on first print, then persisted, so a canvas rename changes one line.
   * Never one of `SDK_RESERVED_IDENTIFIERS`.
   */
  ident: string
  /**
   * Print-order tie-break: the second key of the declaration sort (isTrigger, order, key).
   * Not unique: equal orders fall back to the key, so locks
   * merged from two branches stay valid.
   */
  order: number
  layout?: LockLayout
  /** Repo-relative path of the block's function-code file. */
  codeFile?: string
}

export type WorkflowLockV1 = {
  [extension: LockExtensionKey]: Json
  version: 1
  blocks: Record<BlockKey, WorkflowLockBlock>
  variables: Record<VarKey, string>
}

/** One environment's freshness facts for a lock, `.sim/base.json` (see the module comment). */
export type SourceBase = {
  [extension: LockExtensionKey]: Json
  /** Base format version; a base written before it existed reads as 1. */
  version: 1
  /** The workflow the source was read from; apply refuses a base read from another workflow. */
  workflowId: string
  workspaceId: string
  /** The DB freshness token at pull; apply answers 409 when it no longer matches. */
  fingerprint: string
  /** The catalog `hash` the file was printed against. */
  catalogHash: string
}

type LockDiagnostic = Diagnostic<LockDiagnosticCode>

type ParseWorkflowLockResult =
  | { lock: WorkflowLockV1; diagnostics?: undefined }
  | { lock?: undefined; diagnostics: LockDiagnostic[] }

const DRIVE_PATH = /^[A-Za-z]:/

/** The fields of `T` that are not `x-` extensions. */
export type DefinedField<T> = Exclude<keyof T, LockExtensionKey>

/**
 * The defined field names of `T`, for a versioned-JSON validator's allowed-field list: listing one
 * too few or one too many is a type error, so a field added to `T` fails to compile until its
 * validator learns it.
 */
export function fieldNames<T>(
  fields: { readonly [K in DefinedField<T>]-?: true }
): readonly string[] {
  return Object.keys(fields)
}

const LOCK_FIELDS = fieldNames<WorkflowLockV1>({ version: true, blocks: true, variables: true })
const BLOCK_FIELDS = fieldNames<WorkflowLockBlock>({
  id: true,
  parent: true,
  branches: true,
  items: true,
  ident: true,
  order: true,
  layout: true,
  codeFile: true,
})
const LAYOUT_FIELDS = fieldNames<LockLayout>({
  x: true,
  y: true,
  w: true,
  h: true,
  height: true,
  horizontalHandles: true,
})
const ITEM_FIELDS = fieldNames<LockItem>({ name: true, id: true })
const BASE_FIELDS = fieldNames<SourceBase>({
  version: true,
  workflowId: true,
  workspaceId: true,
  fingerprint: true,
  catalogHash: true,
})

/** The longest `fingerprint` a base may carry. */
const MAX_BASE_FINGERPRINT_LENGTH = 256

type JsonObject = Record<string, unknown>

/** Whether `value` is a string with at least one character. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A print-order tie-break, in the lock and in source meta: a non-negative integer. */
export function isPrintOrder(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** A block's `const` ident, in the lock or in source meta, or why `value` cannot be one. */
export function readIdent(value: unknown): { ident: string } | { problem: string } {
  if (typeof value !== 'string' || !isIdentifierName(value)) {
    return { problem: 'An ident must be a JS identifier.' }
  }
  if (SDK_RESERVED_IDENTIFIERS.has(value)) {
    return { problem: `"${value}" is a reserved word or an SDK export.` }
  }
  return { ident: value }
}

export function isExtensionKey(key: string): key is LockExtensionKey {
  return key.startsWith('x-')
}

/**
 * The `x-` extension fields of `value` outside `known` (JSON values only), which every validator
 * preserves. `onProblem` hears each other unknown field and each extension that is not JSON.
 */
export function readExtensions(
  value: Record<string, unknown>,
  known: readonly string[],
  onProblem: (field: string, problem: 'unknown' | 'not-json') => void
): Record<LockExtensionKey, Json> {
  const extensions: Record<LockExtensionKey, Json> = {}
  for (const [field, raw] of Object.entries(value)) {
    if (known.includes(field)) continue
    if (!isExtensionKey(field)) onProblem(field, 'unknown')
    else if (isJson(raw)) extensions[field] = raw
    else onProblem(field, 'not-json')
  }
  return extensions
}

/** A validator's input as JSON: parsed when given as text, `undefined` when that text is not JSON. */
export function jsonInput(input: unknown): { json: unknown } | undefined {
  if (typeof input !== 'string') return { json: input }
  try {
    return { json: JSON.parse(input) }
  } catch {
    return undefined
  }
}

/** Whether `value` is plain JSON with finite numbers only. */
export function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJson)
  return isRecordLike(value) && Object.values(value).every(isJson)
}

/** One JSON Pointer segment, escaped as RFC 6901 says: `~` → `~0`, `/` → `~1`. */
export function pointerSegment(segment: string | number): string {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1')
}

/** RFC 6901: `~` → `~0`, `/` → `~1`. */
export function pointer(segments: readonly string[]): string {
  return segments.map((segment) => `/${pointerSegment(segment)}`).join('')
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.includes('\\') || path.startsWith('/') || DRIVE_PATH.test(path)) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

class LockReader {
  readonly diagnostics: LockDiagnostic[] = []

  report(code: LockDiagnostic['code'], segments: readonly string[], message: string): void {
    this.diagnostics.push(diagnostic(code, message, { path: pointer(segments) }))
  }

  /**
   * Reports fields outside `known` unless they are `x-` extensions, and returns the extensions
   * (JSON values only) so the parsed lock preserves them.
   */
  extensions(
    value: JsonObject,
    known: readonly string[],
    at: readonly string[]
  ): Record<LockExtensionKey, Json> {
    return readExtensions(value, known, (field, problem) =>
      problem === 'unknown'
        ? this.report('E_LOCK_UNKNOWN_FIELD', [...at, field], `Unknown lock field "${field}".`)
        : this.report('E_LOCK_SHAPE', [...at, field], 'An extension field must hold JSON.')
    )
  }

  /** A string → non-empty-string record whose values are unique within it. */
  idRecord(raw: unknown, at: readonly string[]): Record<string, string> {
    if (!isRecordLike(raw)) {
      this.report('E_LOCK_SHAPE', at, 'Expected an object of id strings.')
      return {}
    }
    const seen = new Set<string>()
    const entries: Array<[string, string]> = []
    for (const [key, id] of Object.entries(raw)) {
      if (!isNonEmptyString(id)) {
        this.report('E_LOCK_SHAPE', [...at, key], 'Expected a non-empty id string.')
        continue
      }
      if (seen.has(id)) {
        this.report('E_LOCK_DUPLICATE_ID', [...at, key], `Id "${id}" is used twice.`)
        continue
      }
      seen.add(id)
      entries.push([key, id])
    }
    return Object.fromEntries(entries)
  }

  itemList(raw: unknown, at: readonly string[]): LockItem[] {
    if (!Array.isArray(raw)) {
      this.report('E_LOCK_SHAPE', at, 'Expected an array of { name, id } items.')
      return []
    }
    const seen = new Set<string>()
    const items: LockItem[] = []
    raw.forEach((entry: unknown, index) => {
      const itemAt = [...at, String(index)]
      if (!isRecordLike(entry)) {
        this.report('E_LOCK_SHAPE', itemAt, 'An item must be an object.')
        return
      }
      for (const field of Object.keys(entry)) {
        if (!ITEM_FIELDS.includes(field)) {
          this.report('E_LOCK_UNKNOWN_FIELD', [...itemAt, field], `Unknown item field "${field}".`)
        }
      }
      if (typeof entry.name !== 'string') {
        this.report('E_LOCK_SHAPE', [...itemAt, 'name'], '"name" must be a string.')
        return
      }
      if (!isNonEmptyString(entry.id)) {
        this.report('E_LOCK_SHAPE', [...itemAt, 'id'], '"id" must be a non-empty string.')
        return
      }
      if (seen.has(entry.id)) {
        this.report('E_LOCK_DUPLICATE_ID', [...itemAt, 'id'], `Id "${entry.id}" is used twice.`)
        return
      }
      seen.add(entry.id)
      items.push({ name: entry.name, id: entry.id })
    })
    return items
  }

  layout(raw: unknown, at: readonly string[]): LockLayout | undefined {
    if (!isRecordLike(raw)) {
      this.report('E_LOCK_SHAPE', at, '"layout" must be an object.')
      return undefined
    }
    const layout: LockLayout = { ...this.extensions(raw, LAYOUT_FIELDS, at), x: 0, y: 0 }
    for (const field of ['x', 'y'] as const) {
      if (isFiniteNumber(raw[field])) layout[field] = raw[field]
      else this.report('E_LOCK_SHAPE', [...at, field], `"${field}" must be a finite number.`)
    }
    for (const field of ['w', 'h', 'height'] as const) {
      const value = raw[field]
      if (value === undefined) continue
      if (isFiniteNumber(value)) layout[field] = value
      else this.report('E_LOCK_SHAPE', [...at, field], `"${field}" must be a finite number.`)
    }
    if (raw.horizontalHandles !== undefined) {
      if (typeof raw.horizontalHandles === 'boolean') {
        layout.horizontalHandles = raw.horizontalHandles
      } else {
        this.report('E_LOCK_SHAPE', [...at, 'horizontalHandles'], 'Expected a boolean.')
      }
    }
    return layout
  }

  block(key: string, raw: unknown): WorkflowLockBlock | undefined {
    const at = ['blocks', key]
    if (!isRecordLike(raw)) {
      this.report('E_LOCK_SHAPE', at, 'A lock block must be an object.')
      return undefined
    }
    const extensions = this.extensions(raw, BLOCK_FIELDS, at)
    if (!key || normalizeWorkflowBlockName(key) !== key) {
      this.report('E_LOCK_KEY', at, `Block key "${key}" is not in normalized form.`)
    }

    let id = ''
    if (isNonEmptyString(raw.id)) id = raw.id
    else this.report('E_LOCK_SHAPE', [...at, 'id'], '"id" must be a non-empty string.')

    let parent: BlockKey | null = null
    if (raw.parent === null || isNonEmptyString(raw.parent)) {
      parent = raw.parent
    } else {
      this.report('E_LOCK_SHAPE', [...at, 'parent'], '"parent" must be a block key or null.')
    }

    const read = readIdent(raw.ident)
    if ('problem' in read) this.report('E_LOCK_IDENT', [...at, 'ident'], read.problem)
    const ident = 'ident' in read ? read.ident : ''

    let order = 0
    if (isPrintOrder(raw.order)) {
      order = raw.order
    } else {
      this.report('E_LOCK_SHAPE', [...at, 'order'], '"order" must be a non-negative integer.')
    }

    const block: WorkflowLockBlock = { ...extensions, id, parent, ident, order }

    if (raw.branches !== undefined) {
      const branches = this.idRecord(raw.branches, [...at, 'branches'])
      for (const branchKey of Object.keys(branches)) {
        if (!isIdentifierName(branchKey)) {
          this.report(
            'E_LOCK_BRANCH',
            [...at, 'branches', branchKey],
            `Branch key "${branchKey}" is not a JS identifier.`
          )
        }
      }
      block.branches = branches
    }

    if (raw.items !== undefined) {
      if (isRecordLike(raw.items)) {
        block.items = Object.fromEntries(
          Object.entries(raw.items).map(([subBlockId, list]) => [
            subBlockId,
            this.itemList(list, [...at, 'items', subBlockId]),
          ])
        )
      } else {
        this.report('E_LOCK_SHAPE', [...at, 'items'], '"items" must be an object.')
      }
    }

    if (raw.layout !== undefined) {
      const layout = this.layout(raw.layout, [...at, 'layout'])
      if (layout) block.layout = layout
    }

    if (raw.codeFile !== undefined) {
      if (typeof raw.codeFile === 'string' && isSafeRelativePath(raw.codeFile)) {
        block.codeFile = raw.codeFile
      } else {
        this.report(
          'E_LOCK_CODE_FILE_PATH',
          [...at, 'codeFile'],
          '"codeFile" must be a normalized relative path inside the repo, using "/".'
        )
      }
    }
    return block
  }

  crossCheckBlocks(blocks: Record<BlockKey, WorkflowLockBlock>): void {
    const idents = new Map<string, BlockKey>()
    const ids = new Map<string, BlockKey>()
    for (const [key, block] of Object.entries(blocks)) {
      if (block.ident) {
        const holder = idents.get(block.ident)
        if (holder === undefined) idents.set(block.ident, key)
        else {
          this.report(
            'E_LOCK_DUPLICATE_IDENT',
            ['blocks', key, 'ident'],
            `Ident "${block.ident}" is already used by "${holder}".`
          )
        }
      }
      if (block.id) {
        const holder = ids.get(block.id)
        if (holder === undefined) ids.set(block.id, key)
        else {
          this.report(
            'E_LOCK_DUPLICATE_ID',
            ['blocks', key, 'id'],
            `Block id "${block.id}" is already used by "${holder}".`
          )
        }
      }
    }

    const cyclic = blocksOnParentCycles(blocks)
    for (const [key, block] of Object.entries(blocks)) {
      if (block.parent === null) continue
      if (!Object.hasOwn(blocks, block.parent)) {
        this.report(
          'E_LOCK_PARENT',
          ['blocks', key, 'parent'],
          `Parent "${block.parent}" is not a block in this lock.`
        )
      } else if (cyclic.has(key)) {
        this.report('E_LOCK_PARENT', ['blocks', key, 'parent'], `"${key}" contains itself.`)
      }
    }
  }

  /** Whether `raw` holds more than `max` entries, a workflow's cap; reported so it is never read. */
  overCap(raw: unknown, max: number, at: readonly string[]): boolean {
    if (!isRecordLike(raw) || Object.keys(raw).length <= max) return false
    this.report('E_LOCK_SHAPE', at, `Expected at most ${max} entries.`)
    return true
  }

  variables(raw: unknown): Record<VarKey, string> {
    const variables = this.idRecord(raw, ['variables'])
    for (const key of Object.keys(variables)) {
      if (!key || normalizeWorkflowBlockName(key) !== key) {
        this.report(
          'E_LOCK_KEY',
          ['variables', key],
          `Variable key "${key}" is not in normalized form.`
        )
      }
    }
    return variables
  }
}

/**
 * The blocks whose parent chain leads back to themselves. Each block is walked once: a walk stops
 * at a block an earlier walk finished, and the blocks from where it meets its own path onward are
 * the cycle.
 */
function blocksOnParentCycles(blocks: Record<BlockKey, WorkflowLockBlock>): Set<BlockKey> {
  const cyclic = new Set<BlockKey>()
  const finished = new Set<BlockKey>()
  for (const start of Object.keys(blocks)) {
    const path: BlockKey[] = []
    const onPath = new Map<BlockKey, number>()
    let current: BlockKey | null = start
    while (current !== null && Object.hasOwn(blocks, current) && !finished.has(current)) {
      const index = onPath.get(current)
      if (index !== undefined) {
        for (const key of path.slice(index)) cyclic.add(key)
        break
      }
      onPath.set(current, path.length)
      path.push(current)
      current = blocks[current].parent
    }
    for (const key of path) finished.add(key)
  }
  return cyclic
}

/**
 * A lock object of any version this build reads, as the current version (1) holds it, or `null`
 * for a version it cannot read. The one seam a lock format change goes through: v1 is current,
 * so it passes through unchanged.
 */
function upgradeWorkflowLock(
  json: Record<string, unknown>
): (Record<string, unknown> & { version: 1 }) | null {
  return json.version === 1 ? { ...json, version: 1 } : null
}

/**
 * A base object of any version this build reads, as the current version (1) holds it, or `null`
 * for a version it cannot read. A base written before `version` existed is version 1.
 */
function upgradeSourceBase(
  json: Record<string, unknown>
): (Record<string, unknown> & { version: 1 }) | null {
  return json.version === undefined || json.version === 1 ? { ...json, version: 1 } : null
}

/**
 * Validates a source base (`.sim/base.json`), given as parsed JSON or as JSON text, through
 * {@link upgradeSourceBase}. Unknown fields are refused except `x-` extensions, which are kept.
 */
export function parseSourceBase(input: unknown): { base: SourceBase } | { problem: string } {
  const parsed = jsonInput(input)
  if (!parsed || !isRecordLike(parsed.json)) return { problem: 'The base is not a JSON object.' }
  const json = upgradeSourceBase(parsed.json)
  if (!json) return { problem: 'Unsupported base version; expected 1.' }
  const problems: string[] = []
  const extensions = readExtensions(json, BASE_FIELDS, (field, problem) =>
    problems.push(
      problem === 'unknown'
        ? `Unknown base field "${field}".`
        : `Extension "${field}" must hold JSON.`
    )
  )
  const workflowId = isNonEmptyString(json.workflowId) ? json.workflowId : undefined
  const workspaceId = typeof json.workspaceId === 'string' ? json.workspaceId : undefined
  const fingerprint =
    isNonEmptyString(json.fingerprint) && json.fingerprint.length <= MAX_BASE_FINGERPRINT_LENGTH
      ? json.fingerprint
      : undefined
  const catalogHash = typeof json.catalogHash === 'string' ? json.catalogHash : undefined
  if (workflowId === undefined) problems.push('"workflowId" must be a non-empty string.')
  if (workspaceId === undefined) problems.push('"workspaceId" must be a string.')
  if (fingerprint === undefined) {
    problems.push(
      `"fingerprint" must be a non-empty string of at most ${MAX_BASE_FINGERPRINT_LENGTH} characters.`
    )
  }
  if (catalogHash === undefined) problems.push('"catalogHash" must be a string.')
  if (
    problems.length > 0 ||
    workflowId === undefined ||
    workspaceId === undefined ||
    fingerprint === undefined ||
    catalogHash === undefined
  ) {
    return { problem: problems.join(' ') }
  }
  return {
    base: { ...extensions, version: 1, workflowId, workspaceId, fingerprint, catalogHash },
  }
}

/**
 * Validates a lock, given as parsed JSON or as JSON text, through {@link upgradeWorkflowLock}.
 * Every problem is reported at once, each with an RFC 6901 `path`; a lock with any problem is
 * rejected whole. Unknown fields are errors, so a typo never silently drops identity, except `x-`
 * extension fields, which are preserved. A version this build cannot read stops validation there.
 */
export function parseWorkflowLock(input: unknown): ParseWorkflowLockResult {
  const reader = new LockReader()
  const parsed = jsonInput(input)
  if (!parsed) {
    reader.report('E_LOCK_JSON', [], 'The lock is not valid JSON.')
    return { diagnostics: reader.diagnostics }
  }
  if (!isRecordLike(parsed.json)) {
    reader.report('E_LOCK_SHAPE', [], 'The lock must be a JSON object.')
    return { diagnostics: reader.diagnostics }
  }
  const json = upgradeWorkflowLock(parsed.json)
  if (!json) {
    reader.report('E_LOCK_VERSION', ['version'], 'Unsupported lock version; expected 1.')
    return { diagnostics: reader.diagnostics }
  }

  // Both counts come before either record is read, so an oversized one never costs a walk of the other.
  const blocksOverCap = reader.overCap(json.blocks, SOURCE_LIMITS.maxBlocks, ['blocks'])
  const variablesOverCap = reader.overCap(json.variables, SOURCE_LIMITS.maxVariables, ['variables'])
  if (blocksOverCap || variablesOverCap) return { diagnostics: reader.diagnostics }

  const extensions = reader.extensions(json, LOCK_FIELDS, [])
  const blockEntries: Array<[BlockKey, WorkflowLockBlock]> = []
  if (!isRecordLike(json.blocks)) {
    reader.report('E_LOCK_SHAPE', ['blocks'], '"blocks" must be an object.')
  } else {
    for (const [key, raw] of Object.entries(json.blocks)) {
      const block = reader.block(key, raw)
      if (block) blockEntries.push([key, block])
    }
  }
  const blocks: Record<BlockKey, WorkflowLockBlock> = Object.fromEntries(blockEntries)
  reader.crossCheckBlocks(blocks)
  const variables = reader.variables(json.variables)

  if (reader.diagnostics.length > 0) return { diagnostics: reader.diagnostics }
  return { lock: { ...extensions, version: 1, blocks, variables } }
}

/**
 * Per-block print hints: the parts of the lock (or of `workflow_source_meta`) the printer
 * reads and the compiler reports. Keyed by block key, since neither stage
 * sees ids.
 */
export type SourceHintBlock = Partial<Pick<WorkflowLockBlock, 'ident' | 'order' | 'codeFile'>>

export interface SourceHints {
  blocks: Record<BlockKey, SourceHintBlock>
}

/**
 * Lock keys the source renamed, old → new: a source block under a key `isStored` rejects whose
 * ident is that of exactly one lock entry, a stored block's, whose key is gone from the source.
 * This is materialize's `lock-ident` identity rule for a dropped key, so a compile that pairs
 * source blocks with stored ones by key agrees with materialize on which stored block a renamed
 * one continues. A swap where both keys survive, which materialize also binds by ident (DESIGN.md
 * rule 2), is left out: the compile reads it by key.
 */
export function lockIdentRenames(
  hints: SourceHints,
  lock: WorkflowLockV1,
  isStored: (key: BlockKey) => boolean
): Map<BlockKey, BlockKey> {
  const vacated = new Map<string, BlockKey[]>()
  for (const [key, entry] of Object.entries(lock.blocks)) {
    if (Object.hasOwn(hints.blocks, key) || !isStored(key)) continue
    vacated.set(entry.ident, [...(vacated.get(entry.ident) ?? []), key])
  }
  const renames = new Map<BlockKey, BlockKey>()
  for (const [key, hint] of Object.entries(hints.blocks)) {
    if (isStored(key) || hint.ident === undefined) continue
    const candidates = vacated.get(hint.ident)
    if (candidates?.length === 1) renames.set(candidates[0], key)
  }
  return renames
}
