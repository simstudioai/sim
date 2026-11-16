import {
  type BlockCatalog,
  type CanonicalizeResult,
  type CanonicalWorkflowMeta,
  canonicalize,
  type Diagnostic,
  type LockIdentity,
  printWorkflow,
  type ResourceKeyResolver,
  type SourceFingerprint,
  sourceFingerprint,
  type WorkflowLockBlock,
  type WorkflowLockV1,
  type WorkflowSourceMetaV1,
} from '@sim/workflow-code'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { buildLockFromState, hintsFromSourceMeta } from '@/lib/workflows/code/source-lock'
import { canonicalizeUnderLock } from '@/lib/workflows/code/stored-canonical'

/** Directory function-code files are printed into when `functionCode` is `files`. */
const FUNCTION_CODE_DIR = 'functions'

/** A stored draft as canonicalize reads it, plus the row fields the canonical `meta` carries. */
export interface StoredSource {
  state: WorkflowState
  meta: CanonicalWorkflowMeta
}

interface PrintStoredSourceInput extends StoredSource {
  catalog: BlockCatalog
  resources: ResourceKeyResolver
  /** The idents, order and comments to print with. */
  sourceMeta: WorkflowSourceMetaV1 | null
  functionCode: 'inline' | 'files'
  /** `state`'s lockless canonical model, when the caller already holds it. */
  lockless?: CanonicalizeResult
  /**
   * Keys to print under: an apply prints the keys its submission bound, so branch keys follow
   * the submitted lock. Omitted, the stored state's own keys print.
   */
  identity?: LockIdentity
}

export interface PrintedSource {
  /** Relative path → text: `workflow.ts` first, then any function-code files. */
  files: Record<string, string>
  lock: WorkflowLockV1
  /** The `sf1:` freshness token of the state, which ignores the lock and canvas positions. */
  fingerprint: SourceFingerprint
  /** The canonical model the files print. */
  canonical: CanonicalizeResult
  /** Print findings. */
  diagnostics: Diagnostic[]
}

/**
 * Prints a stored (or about-to-be-stored) state as source with the idents, order and comments
 * of `sourceMeta`, assembles its lock from the same print, and computes its fingerprint. `source get`
 * and every apply response go through here, so an apply answers with exactly what the next get
 * prints and its fingerprint is the next apply's base.
 */
export function printStoredSource(input: PrintStoredSourceInput): PrintedSource {
  const { state, meta, catalog, resources, sourceMeta } = input
  const lockless = input.lockless ?? canonicalize(state, { catalog, meta, resources })
  const canonical = input.identity
    ? canonicalizeUnderLock(
        state,
        { catalog, meta, resources },
        lockless,
        identityLock(input.identity)
      )
    : lockless
  const metaInputs = hintsFromSourceMeta(sourceMeta, canonical)
  const printed = printWorkflow({
    workflow: {
      ...canonical.workflow,
      annotations: {
        ...canonical.workflow.annotations,
        comments: { ...canonical.workflow.annotations.comments, ...metaInputs.comments },
      },
    },
    catalog,
    hints: metaInputs.hints,
    options:
      input.functionCode === 'files'
        ? { functionCode: 'files', codeDir: FUNCTION_CODE_DIR }
        : { functionCode: 'inline' },
  })
  return {
    files: Object.fromEntries(printed.files.map((file) => [file.path, file.text])),
    lock: buildLockFromState(sourceMeta, canonical, printed.hints),
    fingerprint: sourceFingerprint(lockless.workflow, lockless.identity),
    canonical,
    diagnostics: printed.diagnostics,
  }
}

/** The fingerprint of a stored draft exactly as {@link printStoredSource} computes it. */
export function fingerprintOf(
  stored: StoredSource,
  catalog: BlockCatalog,
  resources: ResourceKeyResolver
): SourceFingerprint {
  const { workflow, identity } = canonicalize(stored.state, {
    catalog,
    meta: stored.meta,
    resources,
  })
  return sourceFingerprint(workflow, identity)
}

/**
 * A lock carrying only identity. `canonicalize` reads a lock's ids and branch keys and nothing
 * else, so the printer-owned fields are placeholders here; the real ones come from the print.
 */
function identityLock(identity: LockIdentity): WorkflowLockV1 {
  const blocks: Record<string, WorkflowLockBlock> = {}
  for (const [key, block] of Object.entries(identity.blocks)) {
    blocks[key] = { ...block, ident: key, order: 0 }
  }
  return { version: 1, blocks, variables: identity.variables }
}

/**
 * The post-materialize lock `mergeSourceMetaFromLock` re-keys onto: every bound key with its id,
 * and the submitted lock's ident and order for a block the file does not state them for.
 */
export function boundLock(identity: LockIdentity, submitted: WorkflowLockV1): WorkflowLockV1 {
  const blocks: Record<string, WorkflowLockBlock> = {}
  for (const [key, block] of Object.entries(identity.blocks)) {
    const previous = Object.hasOwn(submitted.blocks, key) ? submitted.blocks[key] : undefined
    blocks[key] = { ...block, ident: previous?.ident ?? key, order: previous?.order ?? 0 }
  }
  return { version: 1, blocks, variables: identity.variables }
}
