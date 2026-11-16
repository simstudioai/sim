/**
 * Signatures of the engines Wave 2 and Wave 3 implement, one module each. Type-only: there is no
 * runtime stub, so an import of an unimplemented engine fails to resolve instead of failing at
 * run time. Each implementation declares itself against its type, for example
 * `export const canonicalize: CanonicalizeFn = (state, options) => { ... }`.
 */

import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import type { BlockCatalog } from './catalog/types'
import type {
  CanonicalizeDiagnosticCode,
  CompileDiagnosticCode,
  MaterializeDiagnosticCode,
  PrintDiagnosticCode,
} from './diagnostics/codes'
import type { Diagnostic, LocatedDiagnostic, SourceSpan } from './diagnostics/frame'
import type {
  LockIdentity,
  LockLayout,
  SourceFingerprint,
  WorkflowLockBlock,
  WorkflowLockV1,
} from './lock'
import type {
  AnchorKey,
  BlockKey,
  CanonicalEdge,
  CanonicalParamId,
  CanonicalWorkflow,
  CanonicalWorkflowMeta,
  ResourceKind,
  SubBlockId,
  VarKey,
} from './model'

/**
 * Maps workspace resources between internal ids and stable keys. Implemented server-side over the
 * workspace's tables, knowledge bases, credentials (idents) and so on; `null` when there is no
 * mapping.
 */
export interface ResourceKeyResolver {
  toKey(kind: ResourceKind, id: string): string | null
  toId(kind: ResourceKind, key: string): string | null
}

export interface CanonicalizeOptions {
  catalog: BlockCatalog
  /** The workflow row's name and description, which `WorkflowState` does not carry. */
  meta: CanonicalWorkflowMeta
  /** Supplies branch keys by row id (build-spec decision 5); never changes block keys. */
  lock?: WorkflowLockV1 | null
  resources?: ResourceKeyResolver
}

export interface CanonicalizeResult {
  workflow: CanonicalWorkflow
  /** Key → id for every block, branch, item and variable in `workflow`. */
  identity: LockIdentity
  /** Stored positions by key, for the lock. Not part of the CWM. */
  layout: Record<BlockKey, LockLayout>
  diagnostics: Diagnostic<CanonicalizeDiagnosticCode>[]
}

/**
 * Projects a stored, already-migrated graph to the CWM (s1 §2 algorithm; migrations stay
 * server-side, s1 D7). Pure and total: problems become diagnostics, never throws.
 */
export type CanonicalizeFn = (
  state: WorkflowState,
  options: CanonicalizeOptions
) => CanonicalizeResult

/** Server callbacks materialize needs; implemented in `apps/sim/lib/workflows/code/`. */
export interface MaterializeHooks {
  /** A fresh block with editor defaults, wrapping editing/builders (s1 §3). */
  initBlock(input: { id: string; type: string; name: string; triggerMode: boolean }): BlockState
  /** Stored `outputs` for a new or changed block, wrapping `getEffectiveBlockOutputs` (s1 D6). */
  computeOutputs(block: BlockState): BlockState['outputs']
  /** A new UUID for a block, branch row, item or variable. */
  newId(): string
}

/** How identity rule matched a compiled block to a stored one (s1 §4, rules 1–4). */
export type IdentityMatchRule = 'lock-key' | 'lock-ident' | 'db-name' | 'inferred'

/** One block's identity outcome, for plan output and audit. */
export type IdentityEntry =
  | {
      status: 'matched'
      key: BlockKey
      id: string
      via: IdentityMatchRule
      /** Set when the display name changed. */
      renamedFrom?: string
      /** Set for a catalog `sunset.replacedBy` retype that keeps the id. */
      retypedFrom?: string
      /** Set when the parent changed; `null` means it was at the root. */
      reparentedFrom?: BlockKey | null
    }
  | {
      status: 'created'
      key: BlockKey
      id: string
      /** `lock` when the lock's id was unclaimed and reused, else `minted` (s4 §2 step 5). */
      idSource: 'lock' | 'minted'
    }
  | { status: 'deleted'; key: BlockKey; id: string }

export interface MaterializeOptions {
  catalog: BlockCatalog
  hooks: MaterializeHooks
  /** The stored graph being replaced. Absent for a new workflow. */
  prev?: WorkflowState
  resources?: ResourceKeyResolver
  /** Disables identity rule 4 (`--no-infer-renames`). */
  inferRenames?: boolean
  /**
   * Idents as written in the compiled file (`CompileResult.hints`), by block key. Identity
   * rule 2 matches a lock entry whose key is gone by its ident, so a human who edits only the
   * display string keeps the block's id (s1 §4).
   */
  compiledIdents?: Record<BlockKey, string>
  /**
   * How the lock relates to `prev`: `fresh` when its base fingerprint matches the stored graph,
   * `stale` when it does not, `none` when there is no lock. Rule 4 (inferred renames) runs only
   * for `stale` and `none`; a `stale` lock entry whose id left prev is re-created with
   * `W_MAT_DELETED_SINCE_PULL` (s1 §4 "Stale lock").
   */
  lockFreshness: 'fresh' | 'stale' | 'none'
}

export interface MaterializeResult {
  state: WorkflowState
  identity: LockIdentity
  entries: IdentityEntry[]
  /** New blocks with neither a prev nor a lock position, for targeted autolayout (s4 D4). */
  needsLayout: BlockKey[]
  diagnostics: Diagnostic<MaterializeDiagnosticCode>[]
}

/**
 * Writes a CWM back to a stored graph. Byte-identical no-op round trips (O1; build-spec
 * decision 1, s1 D1) require, for every matched block:
 * - each param whose canonical form equals prev's keeps prev's raw value; otherwise the encoding
 *   is prev's raw encoding when present, else the catalog `storage`;
 * - each edge whose `(from, port, to)` tuple matches a prev edge reuses that whole prev edge
 *   object, handles and id included;
 * - a subflow config canonical-equal to prev's is written back verbatim, to both `block.data` and
 *   the loops/parallels map.
 * Server-owned fields come from prev by id (s1 D6).
 */
export type MaterializeFn = (
  workflow: CanonicalWorkflow,
  lock: WorkflowLockV1 | null,
  options: MaterializeOptions
) => MaterializeResult

/** Structural equality ignoring `annotations`, key order and edge order (s1 quirk 28). */
export type CanonicalEqualsFn = (a: CanonicalWorkflow, b: CanonicalWorkflow) => boolean

/** `sha256Hex(stableStringify(workflow minus annotations))`, both from `hash.ts`. */
export type CanonicalHashFn = (workflow: CanonicalWorkflow) => string

/** Block-level fields a diff can name, besides params and modes. */
export type BlockAttribute =
  | 'name'
  | 'type'
  | 'parent'
  | 'enabled'
  | 'locked'
  | 'triggerMode'
  | 'advancedMode'
  | 'errorPort'
  | 'retry'
  | 'branches'
  | 'subflow'
  | 'extra'

export type BlockChange =
  | { kind: 'param'; param: SubBlockId }
  | { kind: 'mode'; canonicalParamId: CanonicalParamId }
  | { kind: 'attribute'; attribute: BlockAttribute }

export interface CanonicalBlockDiff {
  /** The target key; equals the base key unless the block was renamed. */
  key: BlockKey
  baseKey: BlockKey
  changes: BlockChange[]
}

/** A key-based diff of two CWMs. The apply path turns it into s4's id-based summary. */
export interface CanonicalDiff {
  /** True iff every other field is empty. */
  noop: boolean
  meta: Array<keyof CanonicalWorkflowMeta>
  blocks: {
    added: BlockKey[]
    removed: BlockKey[]
    /** Pairs from `renames`; each also appears in `modified` (with a `name` change). */
    renamed: Array<{ from: BlockKey; to: BlockKey }>
    modified: CanonicalBlockDiff[]
  }
  edges: { added: CanonicalEdge[]; removed: CanonicalEdge[] }
  variables: { added: VarKey[]; removed: VarKey[]; modified: VarKey[] }
}

/**
 * Diffs base against target. `renames` (target key → base key, from identity resolution) pairs
 * blocks whose key changed; without it a rename is a remove plus an add.
 */
export type DiffCanonicalFn = (
  base: CanonicalWorkflow,
  target: CanonicalWorkflow,
  renames?: ReadonlyMap<BlockKey, BlockKey>
) => CanonicalDiff

/**
 * Per-block print hints: the parts of the lock (or of `workflow_source_meta`, build-spec
 * decision 6) the printer reads and the compiler reports. Keyed by block key, since neither stage
 * sees ids.
 */
export type SourceHintBlock = Partial<Pick<WorkflowLockBlock, 'ident' | 'order' | 'codeFile'>>

export interface SourceHints {
  blocks: Record<BlockKey, SourceHintBlock>
}

/** Caps on hostile input (s4 D7). Defaults are the compile module's. */
export interface CompileLimits {
  /** Bytes of the entry file, and of each code file. */
  maxBytes?: number
  maxNodes?: number
  /** Nesting depth of the entry file, and bracket depth of each JavaScript code file. */
  maxDepth?: number
  /** Bytes summed over the distinct code files `codeFile()` references. */
  maxCodeFileBytesTotal?: number
  /** `codeFile()` references across the workflow, distinct or not. */
  maxCodeFileRefs?: number
}

export interface CompileInput {
  entry: { path: string; text: string }
  /** Function-code files by repo-relative path; the caller does the I/O. */
  files: ReadonlyMap<string, string>
  catalog: BlockCatalog
  /** The highest `@sim-sdk` major the caller supports. */
  sdkMajor: number
  limits?: CompileLimits
  /**
   * Block keys already bound to stored ids: the keys of the lock, or of the lock assembled from
   * `workflow_source_meta`. A `meta.key` override (a legacy `name~n` collision key or a reserved
   * name) compiles only for one of these, so source can carry a legacy key losslessly but never
   * introduce one. Absent means no override is accepted.
   */
  knownKeys?: ReadonlySet<BlockKey>
  /**
   * The stored workflow the source continues, canonicalized as it was printed. `stored()` (what
   * the printer writes for a secret it never shows) compiles to this workflow's value for the same
   * block key, type and param. Absent means `stored()` is refused, as for a new workflow.
   */
  stored?: CanonicalWorkflow
}

export interface CompileResult {
  /** `null` iff any diagnostic is an error. Name-keyed, like every CWM: ids bind in materialize. */
  workflow: CanonicalWorkflow | null
  diagnostics: LocatedDiagnostic<CompileDiagnosticCode>[]
  /** Where each anchor sits, to map later server findings back to lines. */
  spans: Partial<Record<AnchorKey, SourceSpan>>
  /** Idents as written, `order` as declaration index, and code files, for the lock. */
  hints: SourceHints
  /** The header's major, or `null` when the header is missing. */
  sdkMajor: number | null
}

/** Statically interprets a workflow source file. Never executes it (s3 D2, s4 D7). */
export type CompileWorkflowFn = (input: CompileInput) => CompileResult

export interface PrintOptions {
  /** `files`: function code in `codeDir` files (repo mode); `inline`: `js``...``. */
  functionCode: 'inline' | 'files'
  /** Repo-relative directory for code files; required when `functionCode` is `files`. */
  codeDir?: string
  /** Defaults to 100 (biome.json). */
  lineWidth?: number
}

export interface PrintInput {
  workflow: CanonicalWorkflow
  catalog: BlockCatalog
  hints?: SourceHints
  options: PrintOptions
}

export interface PrintedFile {
  path: string
  text: string
}

export interface PrintResult {
  /** The workflow file first, then code files. */
  files: [PrintedFile, ...PrintedFile[]]
  /** Input hints plus an ident, order and code file for every block. */
  hints: SourceHints
  diagnostics: Diagnostic<PrintDiagnosticCode>[]
}

/**
 * Prints a CWM as a source file. Its output always compiles with zero errors (s3 D12): a block
 * whose type has no catalog builder prints through `block(type, name, params, meta?)`.
 */
export type PrintWorkflowFn = (input: PrintInput) => PrintResult

/**
 * `sf1:` + `sha256Hex(stableStringify({ workflow minus annotations, identity }))` (build-spec
 * decision 11, s4 D3). The CWM already carries variables and locked flags and has no layout, so a
 * canvas drag never fails a push.
 */
export type SourceFingerprintFn = (
  workflow: CanonicalWorkflow,
  identity: LockIdentity
) => SourceFingerprint
