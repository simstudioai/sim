/**
 * `.sim/lock.json`: the committed identity sidecar of a workflow source file. It binds keys to ids
 * so a canvas rename, a drag or a branch reorder never changes identity (build-spec decision 4,
 * s1 §2, s3 D10/D11). Edge ids are never in the lock (s1 D5).
 *
 * The lock holds only environment-independent facts: logical ids, bindings, print order, code
 * files and layout. Everything tied to one environment's stored state (workspace, freshness
 * fingerprint, catalog hash) is the separate {@link LockBase}: single-workflow `source get/apply`
 * returns and takes it beside the lock, and a repo keeps it in `.sim/state/<env>/revision.json`.
 * Logical ids equal physical ids in the home environment; elsewhere
 * `workspace_repo_block_binding` maps them (build-spec decision 4).
 *
 * Version policy: adding an optional field does not bump `lockVersion`. Validators learn a field
 * before writers emit it; until every reader knows a field, data goes under an `x-` key, which
 * every validator tolerates and preserves. Removing or changing the meaning of a field bumps it.
 */

import { isRecordLike } from '@sim/utils/object'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import type { Diagnostic } from './diagnostics/frame'
import type { BlockKey, BranchKey, Json, SubBlockId, VarKey } from './model'
import { SDK_RESERVED_IDENTIFIERS } from './sdk'

/** `sf1:` + lowercase hex SHA-256 (build-spec decision 11, s4 D3). */
export type SourceFingerprint = `sf1:${string}`

/** An extension field: tolerated and preserved by every validator, never interpreted. */
export type LockExtensionKey = `x-${string}`

/** Canvas geometry, used only for new blocks or `layout: 'lock'` applies (s4 D3). */
export interface LockLayout {
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
 * are the Start field ids (blocks/custom/build-config.ts:134-151, s1 §4 "Items").
 */
export interface LockItem {
  name: string
  id: string
}

/**
 * The id-bearing half of a lock block: what canonicalize derives from a stored graph and
 * materialize returns. `sourceFingerprint` hashes exactly this plus the CWM.
 */
export interface LockIdentityBlock {
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

export interface WorkflowLockBlock extends LockIdentityBlock {
  [extension: LockExtensionKey]: Json
  /**
   * The TS `const` identifier the block is printed as (s3 calls it `ident`). Derived camelCase from
   * the name on first print, then persisted, so a canvas rename changes one line
   * (build-spec decision 4). Never one of `SDK_RESERVED_IDENTIFIERS`.
   */
  binding: string
  /**
   * Print-order tie-break: the second key of the declaration sort (isTrigger, order, key)
   * (build-spec decision 10, s3 D10). Not unique: equal orders fall back to the key, so locks
   * merged from two branches stay valid.
   */
  order: number
  layout?: LockLayout
  /** Repo-relative path of the block's function-code file (build-spec decision 9). */
  codeFile?: string
}

export interface WorkflowLockV1 {
  [extension: LockExtensionKey]: Json
  lockVersion: 1
  blocks: Record<BlockKey, WorkflowLockBlock>
  variables: Record<VarKey, string>
}

/** One environment's freshness facts for a lock (see the module comment). */
export interface LockBase {
  workspaceId: string
  /** The DB freshness token at pull; apply answers 409 when it no longer matches. */
  baseFingerprint: SourceFingerprint
  /** The catalog `hash` the file was printed against. */
  catalogHash: string
}

export type LockDiagnostic = Diagnostic<
  | 'E_LOCK_JSON'
  | 'E_LOCK_VERSION'
  | 'E_LOCK_SHAPE'
  | 'E_LOCK_UNKNOWN_FIELD'
  | 'E_LOCK_KEY'
  | 'E_LOCK_BINDING'
  | 'E_LOCK_DUPLICATE_BINDING'
  | 'E_LOCK_DUPLICATE_ID'
  | 'E_LOCK_PARENT'
  | 'E_LOCK_BRANCH'
  | 'E_LOCK_CODE_FILE_PATH'
>

export type ParseWorkflowLockResult =
  | { lock: WorkflowLockV1; diagnostics?: undefined }
  | { lock?: undefined; diagnostics: LockDiagnostic[] }

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const DRIVE_PATH = /^[A-Za-z]:/

const LOCK_FIELDS = ['lockVersion', 'blocks', 'variables']
const BLOCK_FIELDS = ['id', 'parent', 'branches', 'items', 'binding', 'order', 'layout', 'codeFile']
const LAYOUT_FIELDS = ['x', 'y', 'w', 'h', 'height', 'horizontalHandles']
const ITEM_FIELDS = ['name', 'id']

type JsonObject = Record<string, unknown>

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isExtensionKey(key: string): key is LockExtensionKey {
  return key.startsWith('x-')
}

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJson)
  return isRecordLike(value) && Object.values(value).every(isJson)
}

/** RFC 6901: `~` → `~0`, `/` → `~1`. */
function pointer(segments: readonly string[]): string {
  return segments.map((s) => `/${s.replace(/~/g, '~0').replace(/\//g, '~1')}`).join('')
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.includes('\\') || path.startsWith('/') || DRIVE_PATH.test(path)) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

class LockReader {
  readonly diagnostics: LockDiagnostic[] = []

  report(code: LockDiagnostic['code'], segments: readonly string[], message: string): void {
    this.diagnostics.push({ code, severity: 'error', message, path: pointer(segments) })
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
    const extensions: Record<LockExtensionKey, Json> = {}
    for (const [field, raw] of Object.entries(value)) {
      if (known.includes(field)) continue
      if (!isExtensionKey(field)) {
        this.report('E_LOCK_UNKNOWN_FIELD', [...at, field], `Unknown lock field "${field}".`)
      } else if (isJson(raw)) {
        extensions[field] = raw
      } else {
        this.report('E_LOCK_SHAPE', [...at, field], 'An extension field must hold JSON.')
      }
    }
    return extensions
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

    let binding = ''
    if (typeof raw.binding !== 'string' || !IDENTIFIER.test(raw.binding)) {
      this.report('E_LOCK_BINDING', [...at, 'binding'], '"binding" must be a JS identifier.')
    } else if (SDK_RESERVED_IDENTIFIERS.has(raw.binding)) {
      this.report(
        'E_LOCK_BINDING',
        [...at, 'binding'],
        `"${raw.binding}" is a reserved word or an SDK export.`
      )
    } else {
      binding = raw.binding
    }

    let order = 0
    if (typeof raw.order === 'number' && Number.isSafeInteger(raw.order) && raw.order >= 0) {
      order = raw.order
    } else {
      this.report('E_LOCK_SHAPE', [...at, 'order'], '"order" must be a non-negative integer.')
    }

    const block: WorkflowLockBlock = { ...extensions, id, parent, binding, order }

    if (raw.branches !== undefined) {
      const branches = this.idRecord(raw.branches, [...at, 'branches'])
      for (const branchKey of Object.keys(branches)) {
        if (!IDENTIFIER.test(branchKey)) {
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
    const bindings = new Map<string, BlockKey>()
    const ids = new Map<string, BlockKey>()
    for (const [key, block] of Object.entries(blocks)) {
      if (block.binding) {
        const holder = bindings.get(block.binding)
        if (holder === undefined) bindings.set(block.binding, key)
        else {
          this.report(
            'E_LOCK_DUPLICATE_BINDING',
            ['blocks', key, 'binding'],
            `Binding "${block.binding}" is already used by "${holder}".`
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

    for (const [key, block] of Object.entries(blocks)) {
      if (block.parent === null) continue
      if (!Object.hasOwn(blocks, block.parent)) {
        this.report(
          'E_LOCK_PARENT',
          ['blocks', key, 'parent'],
          `Parent "${block.parent}" is not a block in this lock.`
        )
        continue
      }
      const visited = new Set<BlockKey>()
      let current: BlockKey | null = block.parent
      while (current !== null && Object.hasOwn(blocks, current) && !visited.has(current)) {
        if (current === key) {
          this.report('E_LOCK_PARENT', ['blocks', key, 'parent'], `"${key}" contains itself.`)
          break
        }
        visited.add(current)
        current = blocks[current].parent
      }
    }
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
 * Validates a lock, given as parsed JSON or as JSON text. Every problem is reported at once, each
 * with an RFC 6901 `path`; a lock with any problem is rejected whole. Unknown fields are errors,
 * so a typo never silently drops identity, except `x-` extension fields, which are preserved. A
 * version other than 1 stops validation there.
 */
export function parseWorkflowLock(input: unknown): ParseWorkflowLockResult {
  const reader = new LockReader()
  let json = input
  if (typeof input === 'string') {
    try {
      json = JSON.parse(input)
    } catch {
      reader.report('E_LOCK_JSON', [], 'The lock is not valid JSON.')
      return { diagnostics: reader.diagnostics }
    }
  }
  if (!isRecordLike(json)) {
    reader.report('E_LOCK_SHAPE', [], 'The lock must be a JSON object.')
    return { diagnostics: reader.diagnostics }
  }
  if (json.lockVersion !== 1) {
    reader.report('E_LOCK_VERSION', ['lockVersion'], 'Unsupported lock version; expected 1.')
    return { diagnostics: reader.diagnostics }
  }

  const extensions = reader.extensions(json, LOCK_FIELDS, [])
  const blockEntries: Array<[BlockKey, WorkflowLockBlock]> = []
  if (isRecordLike(json.blocks)) {
    for (const [key, raw] of Object.entries(json.blocks)) {
      const block = reader.block(key, raw)
      if (block) blockEntries.push([key, block])
    }
  } else {
    reader.report('E_LOCK_SHAPE', ['blocks'], '"blocks" must be an object.')
  }
  const blocks: Record<BlockKey, WorkflowLockBlock> = Object.fromEntries(blockEntries)
  reader.crossCheckBlocks(blocks)
  const variables = reader.variables(json.variables)

  if (reader.diagnostics.length > 0) return { diagnostics: reader.diagnostics }
  return { lock: { ...extensions, lockVersion: 1, blocks, variables } }
}
