import {
  type CanonicalizeResult,
  type CanonicalWorkflowMeta,
  canonicalizeUnderLock,
  type Diagnostic,
  parseWorkflowLock,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import { diagnostic } from '@sim/workflow-code/diagnostics'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import type { WorkflowSourceDiagnostic } from '@/lib/workflows/application/source-error'
import { createLocator, hasErrors } from '@/lib/workflows/application/source-locate'
import type { SourceEvaluationInput } from '@/lib/workflows/application/source-pipeline/evaluate/types'
import { compileSource } from '@/lib/workflows/code/compile-source'

type SourceCompile = ReturnType<typeof compileSource>

/** The compile phase's result: the submission compiled against the stored graph under its lock. */
export interface CompiledSubmission {
  lock: WorkflowLockV1
  /**
   * The stored graph as the submitted lock reads it: what `stored()` keeps values from, what
   * materialize matches against, and what the diff compares the compiled source against.
   */
  storedCanonical: CanonicalizeResult
  /** What the compile read, kept to compile again with the renames materialize infers. */
  compileInput: Omit<Parameters<typeof compileSource>[0], 'stored' | 'lock'>
  compiled: SourceCompile
  compiledWorkflow: NonNullable<SourceCompile['workflow']>
  /** The stored name and description, or for a create the caller's overrides of the source's. */
  meta: CanonicalWorkflowMeta
}

/**
 * Parses the submitted lock and compiles the files against the live catalog and the stored graph
 * read under that lock. Refuses a lock that does not parse, or a source that does not compile
 * (noting a catalog that moved since the read, which can explain the errors).
 */
export function compileSubmission(
  input: SourceEvaluationInput
): { refused: WorkflowSourceDiagnostic[] } | CompiledSubmission {
  const { catalog, files } = input

  const parsedLock = parseWorkflowLock(input.lock)
  if (parsedLock.diagnostics) {
    return { refused: parsedLock.diagnostics.map(createLocator(files, {}, new Map())) }
  }
  const lock = parsedLock.lock

  const { state } = input.stored
  const storedCanonical = canonicalizeUnderLock(
    state,
    { catalog, meta: input.stored.meta, resources: input.storedCanonical.resources },
    input.storedCanonical.canonical,
    lock
  )
  const compileInput = {
    entry: { path: SOURCE_ENTRY_FILE, text: files[SOURCE_ENTRY_FILE] },
    files: new Map(Object.entries(files).filter(([path]) => path !== SOURCE_ENTRY_FILE)),
    catalog,
    sdkMajor: catalog.sdkMajor,
    knownKeys: new Set([
      ...Object.keys(lock.blocks),
      ...Object.keys(storedCanonical.identity.blocks),
    ]),
    envNames: input.envNames,
  }
  const compiled = compileSource({ ...compileInput, stored: storedCanonical.workflow, lock })
  const compiledWorkflow = compiled.workflow
  if (!compiledWorkflow || hasErrors(compiled.diagnostics)) {
    const refused: Diagnostic[] = [...compiled.diagnostics]
    if (input.base && input.base.catalogHash !== catalog.hash) {
      refused.push(
        diagnostic(
          'W_APPLY_CATALOG_MOVED',
          'The block catalog changed since this source was read, which can explain these errors.',
          {
            hint: 'Get the source again to print it against the current catalog, then reapply your edit.',
          }
        )
      )
    }
    return { refused: refused.map(createLocator(files, compiled.spans, new Map())) }
  }

  const meta = input.create
    ? {
        name: input.create.name ?? compiledWorkflow.meta.name,
        description:
          input.create.description !== undefined
            ? input.create.description
            : compiledWorkflow.meta.description,
      }
    : input.stored.meta
  return { lock, storedCanonical, compileInput, compiled, compiledWorkflow, meta }
}
