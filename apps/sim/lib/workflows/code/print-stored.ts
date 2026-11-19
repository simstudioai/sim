import {
  type BlockCatalog,
  type CanonicalizeResult,
  type CanonicalWorkflowMeta,
  canonicalDigests,
  canonicalHash,
  canonicalize,
  canonicalizeUnderLock,
  type Diagnostic,
  type LockIdentity,
  printWorkflow,
  type ResourceKeyResolver,
  type SourceFingerprint,
  setOwn,
  sourceFingerprint,
  type WorkflowLockV1,
  type WorkflowSourceMetaV1,
} from '@sim/workflow-code'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { withCredentialIds } from '@/lib/workflows/code/credential-nodes'
import { buildLockFromState, hintsFromSourceMeta } from '@/lib/workflows/code/source-lock'

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
  /**
   * Function-code file paths by block key: the ones the submission wrote, so a write answers
   * with the author's file names instead of deriving new ones from the idents.
   */
  codeFiles?: Record<string, string>
}

/** A stored workflow printed as source, with the lock and freshness token that go with it. */
export interface PrintedSource {
  /** Relative path → text: `workflow.ts` first, then any function-code files. */
  files: Record<string, string>
  lock: WorkflowLockV1
  /** The `sf1:` freshness token of the state, which ignores the lock and canvas positions. */
  fingerprint: SourceFingerprint
  diagnostics: Diagnostic[]
  /** The printer's upper bound on `workflow.ts`'s syntax-tree depth. */
  entryDepth: number
}

/**
 * Digests by lockless model. One source get or apply digests the same model up to three times
 * (the base check, the print, the no-op "before" print); weak keys keep an entry exactly as long
 * as its model, which nothing mutates after canonicalize returns it.
 */
const digestsByModel = new WeakMap<
  CanonicalizeResult,
  { fingerprint: SourceFingerprint; canonicalHash?: string }
>()

/**
 * The `sf1:` fingerprint of a lockless canonical model: what {@link printStoredSource} reports
 * and what every apply compares `base.fingerprint` against. Computed once per model.
 *
 * It hashes every credential by its stored id ({@link withCredentialIds}), never by the key the
 * reader's model may print, so it depends on the stored workflow alone: members who may see
 * different credentials read one fingerprint, and a base one of them wrote stays fresh for the
 * other. `resources` is the resolver `lockless` was canonicalized with.
 */
export function storedSourceFingerprint(
  lockless: CanonicalizeResult,
  resources: Pick<ResourceKeyResolver, 'toId'>
): SourceFingerprint {
  const cached = digestsByModel.get(lockless)
  if (cached) return cached.fingerprint
  const fingerprint = sourceFingerprint(
    withCredentialIds(lockless.workflow, resources),
    lockless.identity
  )
  digestsByModel.set(lockless, { fingerprint })
  return fingerprint
}

/**
 * `canonicalHash` of a lockless canonical model, from the same serialization as its fingerprint
 * when the model names no credential by key.
 */
export function storedCanonicalHash(
  lockless: CanonicalizeResult,
  resources: Pick<ResourceKeyResolver, 'toId'>
): string {
  const cached = digestsByModel.get(lockless)
  if (cached?.canonicalHash !== undefined) return cached.canonicalHash
  const fingerprinted = withCredentialIds(lockless.workflow, resources)
  const digests =
    fingerprinted === lockless.workflow
      ? canonicalDigests(lockless.workflow, lockless.identity)
      : {
          canonicalHash: canonicalHash(lockless.workflow),
          fingerprint: cached?.fingerprint ?? sourceFingerprint(fingerprinted, lockless.identity),
        }
  digestsByModel.set(lockless, digests)
  return digests.canonicalHash
}

/**
 * Prints a stored (or about-to-be-stored) state as source with the idents, order and comments
 * of `sourceMeta`, assembles its lock from the same print, and computes its fingerprint. `source get`
 * and every apply response go through here, so an apply answers with exactly what the next get
 * prints and its fingerprint is the next apply's base.
 */
export function printStoredSource(input: PrintStoredSourceInput): PrintedSource {
  const { state, meta, catalog, resources, sourceMeta } = input
  const options = { catalog, meta, resources }
  const lockless = input.lockless ?? canonicalize(state, options)
  const canonical = input.identity
    ? canonicalizeUnderLock(state, options, lockless, input.identity)
    : lockless
  const metaInputs = hintsFromSourceMeta(sourceMeta, canonical)
  for (const [key, codeFile] of Object.entries(input.codeFiles ?? {})) {
    if (!Object.hasOwn(canonical.identity.blocks, key)) continue
    setOwn(metaInputs.hints.blocks, key, { ...metaInputs.hints.blocks[key], codeFile })
  }
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
  return {
    files: Object.fromEntries(printed.files.map((file) => [file.path, file.text])),
    lock: buildLockFromState(sourceMeta, canonical, printed.hints),
    fingerprint: storedSourceFingerprint(lockless, resources),
    diagnostics: printed.diagnostics,
    entryDepth: printed.entryDepth,
  }
}
