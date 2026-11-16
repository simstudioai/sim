/**
 * `.sim/lock.json`: the identity sidecar of a workflow source file. It binds keys to ids so a
 * canvas rename, a drag or a branch reorder never changes identity (build-spec decision 4,
 * s1 §2 `WorkflowLockV1`, s3 D10/D11).
 *
 * Ids are physical ids for single-workflow `source get/apply`; in a repo they are logical ids that
 * equal the physical ones in the home environment (build-spec decision 4). Edge ids are never in
 * the lock (s1 D5).
 */

import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import type { Diagnostic } from './diagnostics/frame'
import type { BlockKey, BranchKey, SubBlockId, VarKey } from './model'

/** `sf1:` + lowercase hex SHA-256 (build-spec decision 11, s4 D3). */
export type SourceFingerprint = `sf1:${string}`

/** Canvas geometry, used only for new blocks or `layout: 'lock'` applies (s4 D3). */
export interface LockLayout {
  x: number
  y: number
  w?: number
  h?: number
  /** Stored `block.height`. */
  height?: number
  horizontalHandles?: boolean
}

/**
 * The id-bearing half of a lock block: what canonicalize derives from a stored graph and
 * materialize returns. `sourceFingerprint` hashes exactly this plus the CWM.
 */
export interface LockIdentityBlock {
  id: string
  type: string
  /** Display name at pull time; the three-way base when the canvas renamed the block (s1 §4). */
  name: string
  parent: BlockKey | null
  /** Branch key → stored row id (condition/router only). */
  branches?: Record<BranchKey, string>
  /**
   * Per subBlock, item name → item id for id-bearing lists (inputFormat field ids). These are
   * cross-workflow foreign keys: custom block subBlock ids are the Start field ids
   * (blocks/custom/build-config.ts:134-151, s1 §4 "Items").
   */
  items?: Record<SubBlockId, Record<string, string>>
}

/** The ids of one workflow, keyed the way the CWM is. */
export interface LockIdentity {
  blocks: Record<BlockKey, LockIdentityBlock>
  /** Variable key → variable id. */
  variables: Record<VarKey, string>
}

export interface WorkflowLockBlock extends LockIdentityBlock {
  /**
   * The TS `const` identifier the block is printed as (s3 calls it `ident`). Derived camelCase from
   * the name on first print, then persisted, so a canvas rename changes one line
   * (build-spec decision 4).
   */
  binding: string
  /**
   * Print-order tie-break: the second key of the declaration sort (isTrigger, order, key)
   * (build-spec decision 10, s3 D10). Not unique: equal orders fall back to the key, so locks
   * merged from two branches stay valid.
   */
  order: number
  /** Lowercase hex SHA-256 of the canonical block (`canonicalHash` over that block alone). */
  contentHash: string
  layout?: LockLayout
  /** Repo-relative path of the block's function-code file (build-spec decision 9). */
  codeFile?: string
}

export interface WorkflowLockV1 {
  lockVersion: 1
  workflowId: string
  workspaceId: string
  /** The catalog `hash` the file was printed against. */
  catalogHash: string
  /** The DB freshness token at pull; apply answers 409 when it no longer matches. */
  baseFingerprint: SourceFingerprint
  blocks: Record<BlockKey, WorkflowLockBlock>
  variables: Record<VarKey, string>
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

const HEX_SHA256 = /^[0-9a-f]{64}$/
const FINGERPRINT = /^sf1:[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const COLLISION_SUFFIX = /^(.*)~([2-9]|[1-9][0-9]+)$/
const DRIVE_PATH = /^[A-Za-z]:/

/** Reserved words plus strict-mode restrictions; none can name a `const`. */
const RESERVED_IDENTIFIERS = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

const LOCK_FIELDS = [
  'lockVersion',
  'workflowId',
  'workspaceId',
  'catalogHash',
  'baseFingerprint',
  'blocks',
  'variables',
]
const BLOCK_FIELDS = [
  'id',
  'type',
  'name',
  'binding',
  'order',
  'parent',
  'contentHash',
  'branches',
  'items',
  'layout',
  'codeFile',
]
const LAYOUT_FIELDS = ['x', 'y', 'w', 'h', 'height', 'horizontalHandles']

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSourceFingerprint(value: unknown): value is SourceFingerprint {
  return typeof value === 'string' && FINGERPRINT.test(value)
}

/** RFC 6901: `~` → `~0`, `/` → `~1`. */
function pointer(segments: readonly string[]): string {
  return segments.map((s) => `/${s.replace(/~/g, '~0').replace(/\//g, '~1')}`).join('')
}

/** Whether `key` is the key `name` normalizes to, or its `~n` legacy-collision form. */
function keyMatchesName(key: string, name: string): boolean {
  const normalized = normalizeWorkflowBlockName(name)
  if (key === normalized) return true
  const collision = COLLISION_SUFFIX.exec(key)
  return collision !== null && collision[1] === normalized
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

  rejectUnknownFields(value: JsonObject, known: readonly string[], at: readonly string[]): void {
    for (const field of Object.keys(value)) {
      if (!known.includes(field)) {
        this.report('E_LOCK_UNKNOWN_FIELD', [...at, field], `Unknown lock field "${field}".`)
      }
    }
  }

  string(value: JsonObject, field: string, at: readonly string[]): string {
    const raw = value[field]
    if (isNonEmptyString(raw)) return raw
    this.report('E_LOCK_SHAPE', [...at, field], `"${field}" must be a non-empty string.`)
    return ''
  }

  /** A string → non-empty-string record whose values are unique within it. */
  idRecord(raw: unknown, at: readonly string[]): Record<string, string> {
    if (!isObject(raw)) {
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

  layout(raw: unknown, at: readonly string[]): LockLayout | undefined {
    if (!isObject(raw)) {
      this.report('E_LOCK_SHAPE', at, '"layout" must be an object.')
      return undefined
    }
    this.rejectUnknownFields(raw, LAYOUT_FIELDS, at)
    const layout: LockLayout = { x: 0, y: 0 }
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
    if (!isObject(raw)) {
      this.report('E_LOCK_SHAPE', at, 'A lock block must be an object.')
      return undefined
    }
    this.rejectUnknownFields(raw, BLOCK_FIELDS, at)
    const keyIsNormalized = key.length > 0 && normalizeWorkflowBlockName(key) === key
    if (!keyIsNormalized) {
      this.report('E_LOCK_KEY', at, `Block key "${key}" is not in normalized form.`)
    }

    const id = this.string(raw, 'id', at)
    const type = this.string(raw, 'type', at)
    const name = this.string(raw, 'name', at)
    if (keyIsNormalized && name && !keyMatchesName(key, name)) {
      this.report('E_LOCK_KEY', [...at, 'name'], `Name "${name}" does not normalize to "${key}".`)
    }

    let binding = ''
    if (typeof raw.binding !== 'string' || !IDENTIFIER.test(raw.binding)) {
      this.report('E_LOCK_BINDING', [...at, 'binding'], '"binding" must be a JS identifier.')
    } else if (RESERVED_IDENTIFIERS.has(raw.binding)) {
      this.report('E_LOCK_BINDING', [...at, 'binding'], `"${raw.binding}" is a reserved word.`)
    } else {
      binding = raw.binding
    }

    let order = 0
    if (typeof raw.order === 'number' && Number.isSafeInteger(raw.order) && raw.order >= 0) {
      order = raw.order
    } else {
      this.report('E_LOCK_SHAPE', [...at, 'order'], '"order" must be a non-negative integer.')
    }

    let parent: BlockKey | null = null
    if (raw.parent === null || isNonEmptyString(raw.parent)) {
      parent = raw.parent
    } else {
      this.report('E_LOCK_SHAPE', [...at, 'parent'], '"parent" must be a block key or null.')
    }

    let contentHash = ''
    if (typeof raw.contentHash === 'string' && HEX_SHA256.test(raw.contentHash)) {
      contentHash = raw.contentHash
    } else {
      this.report('E_LOCK_SHAPE', [...at, 'contentHash'], 'Expected a lowercase hex SHA-256.')
    }

    const block: WorkflowLockBlock = { id, type, name, binding, order, parent, contentHash }

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
      if (isObject(raw.items)) {
        block.items = Object.fromEntries(
          Object.entries(raw.items).map(([subBlockId, entries]) => [
            subBlockId,
            this.idRecord(entries, [...at, 'items', subBlockId]),
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
 * so a typo never silently drops identity. A version other than 1 stops validation there.
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
  if (!isObject(json)) {
    reader.report('E_LOCK_SHAPE', [], 'The lock must be a JSON object.')
    return { diagnostics: reader.diagnostics }
  }
  if (json.lockVersion !== 1) {
    reader.report('E_LOCK_VERSION', ['lockVersion'], 'Unsupported lock version; expected 1.')
    return { diagnostics: reader.diagnostics }
  }

  reader.rejectUnknownFields(json, LOCK_FIELDS, [])
  const workflowId = reader.string(json, 'workflowId', [])
  const workspaceId = reader.string(json, 'workspaceId', [])
  const catalogHash = reader.string(json, 'catalogHash', [])
  let baseFingerprint: SourceFingerprint = 'sf1:'
  if (isSourceFingerprint(json.baseFingerprint)) {
    baseFingerprint = json.baseFingerprint
  } else {
    reader.report('E_LOCK_SHAPE', ['baseFingerprint'], 'Expected "sf1:" + a lowercase hex SHA-256.')
  }

  const blockEntries: Array<[BlockKey, WorkflowLockBlock]> = []
  if (isObject(json.blocks)) {
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
  return {
    lock: {
      lockVersion: 1,
      workflowId,
      workspaceId,
      catalogHash,
      baseFingerprint,
      blocks,
      variables,
    },
  }
}
