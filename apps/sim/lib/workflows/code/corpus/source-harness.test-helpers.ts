/**
 * The workflow source get and apply pipelines as pure functions over a stored state, exactly as
 * `readWorkflowSource` and `evaluateSource` run them minus the database: print through
 * `printStoredSource` (the lock assembled from the same print), then canonicalize the stored state
 * under that lock, compile against it, and materialize over it. Test-only.
 */

import {
  type BlockCatalog,
  type CanonicalizeResult,
  type CanonicalWorkflow,
  type CompileResult,
  canonicalize,
  canonicalizeUnderLock,
  diffCanonical,
  type MaterializeResult,
  materialize,
  printWorkflow,
  type SourceHints,
  setOwn,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { compileSource } from '@/lib/workflows/code/compile-source'
import { CORPUS_RESOURCES } from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { printStoredSource } from '@/lib/workflows/code/print-stored'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const hooks = createMaterializeHooks()

const FUZZ_META = { name: 'Fidelity fuzz', description: null }

/** What `source get` answers for a stored state. */
export interface GotSource {
  lockless: CanonicalizeResult
  files: Record<string, string>
  lock: WorkflowLockV1
}

export function getSource(state: WorkflowState, catalog: BlockCatalog): GotSource {
  const options = { catalog, meta: FUZZ_META, resources: CORPUS_RESOURCES }
  const lockless = canonicalize(state, options)
  const printed = printStoredSource({
    state,
    meta: FUZZ_META,
    catalog,
    resources: CORPUS_RESOURCES,
    sourceMeta: null,
    functionCode: 'inline',
    lockless,
  })
  return { lockless, files: printed.files, lock: printed.lock }
}

/** The submitted lock's hints, for re-printing an edited model the way the author's file reads. */
export function hintsOfLock(lock: WorkflowLockV1): SourceHints {
  const hints: SourceHints = { blocks: {} }
  for (const [key, entry] of Object.entries(lock.blocks)) {
    setOwn(hints.blocks, key, { ident: entry.ident, order: entry.order })
  }
  return hints
}

export function printFiles(
  workflow: CanonicalWorkflow,
  catalog: BlockCatalog,
  hints: SourceHints
): Record<string, string> {
  const printed = printWorkflow({ workflow, catalog, hints, options: { functionCode: 'inline' } })
  return Object.fromEntries(printed.files.map((file) => [file.path, file.text]))
}

/** What `source apply` evaluates for `files` against the stored state, before its gates. */
export interface AppliedSource {
  /** The stored state canonicalized under the submitted lock. */
  stored: CanonicalizeResult
  compiled: CompileResult
  materialized: MaterializeResult | null
  /** `diffCanonical(stored, written)`, as the apply decides `noop` by. */
  noop: boolean | null
}

export function applySource(
  state: WorkflowState,
  got: GotSource,
  files: Record<string, string>,
  catalog: BlockCatalog
): AppliedSource {
  const options = { catalog, meta: FUZZ_META, resources: CORPUS_RESOURCES }
  const stored = canonicalizeUnderLock(state, options, got.lockless, got.lock)
  const compiled = compileSource({
    entry: { path: SOURCE_ENTRY_FILE, text: files[SOURCE_ENTRY_FILE] },
    files: new Map(Object.entries(files).filter(([path]) => path !== SOURCE_ENTRY_FILE)),
    catalog,
    sdkMajor: catalog.sdkMajor,
    knownKeys: new Set([...Object.keys(got.lock.blocks), ...Object.keys(stored.identity.blocks)]),
    stored: stored.workflow,
    lock: got.lock,
  })
  if (!compiled.workflow || compiled.diagnostics.some((d) => d.severity === 'error')) {
    return { stored, compiled, materialized: null, noop: null }
  }
  const compiledIdents: Record<string, string> = {}
  for (const [key, hint] of Object.entries(compiled.hints.blocks)) {
    if (hint.ident !== undefined) compiledIdents[key] = hint.ident
  }
  const hasLockEntries =
    Object.keys(got.lock.blocks).length > 0 || Object.keys(got.lock.variables).length > 0
  const materialized = materialize(compiled.workflow, got.lock, {
    catalog,
    hooks,
    prev: state,
    prevCanonical: stored,
    resources: CORPUS_RESOURCES,
    compiledIdents,
    lockFreshness: hasLockEntries ? 'fresh' : 'none',
  })
  const noop = diffCanonical(stored.workflow, {
    ...materialized.workflow,
    meta: stored.workflow.meta,
  }).noop
  return { stored, compiled, materialized, noop }
}
