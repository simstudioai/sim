import {
  type BlockCatalog,
  type CanonicalizeResult,
  type CanonicalWorkflowMeta,
  canonicalDigests,
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
  /** `canonicalHash` of the same lockless model, from the same serialization. */
  canonicalHash: string
  /** The canonical model the files print. */
  canonical: CanonicalizeResult
  /** Print findings. */
  diagnostics: Diagnostic[]
  /** The printer's upper bound on `workflow.ts`'s syntax-tree depth. */
  entryDepth: number
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
        boundLock(input.identity)
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
    options: { functionCode: input.functionCode },
  })
  const digests = canonicalDigests(lockless.workflow, lockless.identity)
  return {
    files: Object.fromEntries(printed.files.map((file) => [file.path, file.text])),
    lock: buildLockFromState(sourceMeta, canonical, printed.hints),
    fingerprint: digests.fingerprint,
    canonicalHash: digests.canonicalHash,
    canonical,
    diagnostics: printed.diagnostics,
    entryDepth: printed.entryDepth,
  }
}

/**
 * The `sf1:` fingerprint of a lockless canonical model: what {@link printStoredSource} reports
 * and what every apply compares `base.fingerprint` against.
 */
export function fingerprintOf(
  lockless: Pick<CanonicalizeResult, 'workflow' | 'identity'>
): SourceFingerprint {
  return sourceFingerprint(lockless.workflow, lockless.identity)
}

/**
 * The post-materialize lock `mergeSourceMetaFromLock` re-keys onto: every bound key with its id,
 * and the submitted lock's ident and order for a block the file does not state them for. Without
 * a submitted lock it carries only identity: `canonicalize` reads a lock's ids and branch keys and
 * nothing else, so the printer-owned fields are placeholders the print replaces.
 */
export function boundLock(identity: LockIdentity, submitted?: WorkflowLockV1): WorkflowLockV1 {
  const blocks: Record<string, WorkflowLockBlock> = {}
  for (const [key, block] of Object.entries(identity.blocks)) {
    const previous =
      submitted && Object.hasOwn(submitted.blocks, key) ? submitted.blocks[key] : undefined
    blocks[key] = { ...block, ident: previous?.ident ?? key, order: previous?.order ?? 0 }
  }
  return { version: 1, blocks, variables: identity.variables }
}
