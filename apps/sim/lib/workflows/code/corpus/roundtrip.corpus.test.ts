/**
 * The round-trip harness (DESIGN.md "Proof") over every corpus: the generated
 * registry corpus, the landing templates, the `@sim/testing` states, redacted production states
 * from `ROUNDTRIP_CORPUS_EXTRA_DIR` (written outside the repo by
 * scripts/export-redacted-workflows.ts), and fast-check workflows.
 *
 * It imports every engine (catalog, canonicalize, print, compile, equivalence, materialize and the
 * server's materialize hooks) statically and builds the real catalog from the live registry.
 *
 * CI budget (under 60 s): by default every block type keeps a few cases (`corpusSubjects`)
 * plus every structural case; `ROUNDTRIP_CORPUS_FULL=1` runs the whole corpus. Set
 * `ROUNDTRIP_CORPUS_REPORT_PATH` to write the JSON report (per-block-type parity).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import { getErrorMessage } from '@sim/utils/errors'
import { compareStrings } from '@sim/utils/string'
import {
  type CanonicalWorkflow,
  type CompileResult,
  canonicalEquals,
  canonicalize,
  compileWorkflow,
  diffCanonical,
  executableView,
  materialize,
  printWorkflow,
} from '@sim/workflow-code'
import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'
import { generateRejectedCorpus } from '@/lib/workflows/code/corpus'
import {
  CORPUS_RESOURCES,
  corpusBudgetMs,
  corpusSubjects,
  type ProofSubject,
  withoutLockHeldState,
} from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import {
  assertNoErrors,
  assertNoopDiff,
  assertNoopIdentity,
  createProofReport,
  executionParity,
  idempotence,
  type OracleResult,
  type ProofProperty,
  reportPathVariable,
} from '@/lib/workflows/code/corpus/proof'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { hasWorkflowChanged } from '@/lib/workflows/comparison/compare'
import { Serializer } from '@/serializer'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const SUITE = 'roundtrip-corpus'
/**
 * One property over the reduced default corpus. The first property to run pays for the shared
 * source run (canonicalize, print, compile per workflow); the whole file stays inside the 60 s CI
 * budget. This is the floor of `corpusBudgetMs`, which scales the timeout with the corpus size,
 * so `ROUNDTRIP_CORPUS_FULL=1` gets a per-workflow allowance instead of this constant.
 */
const PROPERTY_BUDGET_MS = 30_000

const hooks = createMaterializeHooks()

/** Properties that serialize the original, which an unknown block type makes throw. */
const SERIALIZING_PROPERTIES: ReadonlySet<ProofProperty> = new Set(['P2', 'O2'])

const subjects: ProofSubject[] = corpusSubjects()

/** Cases the registry corpus generates from one block's declarations, every value one it can hold. */
const REGISTRY_CASE = /^(operation|trigger|standalone-advanced|error-edge):/

const report = createProofReport(SUITE)

const serializer = new Serializer()
const serialize = (state: WorkflowState) =>
  serializer.serializeWorkflow(state.blocks, state.edges, state.loops, state.parallels)

/** One subject's canonical form, its inline print and that print compiled: P0, P3, P4, P5 share it. */
interface SourceRun {
  canonical: CanonicalWorkflow
  printed: ReturnType<typeof printWorkflow>
  compiled: CompileResult
}

const sourceRuns = new WeakMap<ProofSubject, SourceRun>()

function sourceRun(subject: ProofSubject): SourceRun {
  const cached = sourceRuns.get(subject)
  if (cached) return cached
  const workflow = canonicalize(subject.state, {
    catalog,
    meta: { name: subject.id, description: null },
    resources: CORPUS_RESOURCES,
  }).workflow
  const printed = printText(workflow, 'inline')
  const run = {
    canonical: workflow,
    printed,
    compiled: compileFiles(printed, workflow),
  }
  sourceRuns.set(subject, run)
  return run
}

function canonical(subject: ProofSubject): CanonicalWorkflow {
  return sourceRun(subject).canonical
}

function compiledOrThrow(compiled: CompileResult): CanonicalWorkflow {
  if (!compiled.workflow) {
    throw new Error(`compile failed: ${compiled.diagnostics.map((d) => d.code).join(', ')}`)
  }
  return compiled.workflow
}

function printText(workflow: CanonicalWorkflow, mode: 'inline' | 'files') {
  return printWorkflow({
    workflow,
    catalog,
    options: { functionCode: mode },
  })
}

/**
 * Compiles a print of `stored` as apply does: against the stored keys and values it continues.
 * The stored keys are the ones the lock (or the lock assembled from source meta) binds to ids;
 * they let a printed `meta.key` keep a legacy collision key or a reserved name through compile.
 */
function compileFiles(printed: ReturnType<typeof printWorkflow>, stored: CanonicalWorkflow) {
  const [entry, ...codeFiles] = printed.files
  return compileWorkflow({
    entry,
    files: new Map(codeFiles.map((file) => [file.path, file.text])),
    catalog,
    sdkMajor: catalog.sdkMajor,
    knownKeys: new Set(Object.keys(stored.blocks)),
    stored,
  })
}

function compiledWorkflow(workflow: CanonicalWorkflow, mode: 'inline' | 'files' = 'inline') {
  return compiledOrThrow(compileFiles(printText(workflow, mode), workflow))
}

function materialized(workflow: CanonicalWorkflow, prev?: WorkflowState) {
  return materialize(workflow, null, {
    catalog,
    hooks,
    prev,
    resources: CORPUS_RESOURCES,
    lockFreshness: 'none',
  }).state
}

const properties: Record<ProofProperty, (s: ProofSubject) => OracleResult> = {
  P0: (s) =>
    idempotence({
      oracle: 'P0',
      value: executableView(canonical(s), catalog),
      step: () => executableView(compiledOrThrow(sourceRun(s).compiled), catalog),
    }),
  P1: (s) => {
    const original = canonical(s)
    return idempotence({
      oracle: 'P1',
      value: executableView(original, catalog),
      step: () =>
        executableView(
          canonicalize(materialized(compiledWorkflow(original), s.state), {
            catalog,
            meta: original.meta,
            resources: CORPUS_RESOURCES,
          }).workflow,
          catalog
        ),
    })
  },
  P2: (s) =>
    executionParity({
      original: s.state,
      candidate: materialized(compiledWorkflow(canonical(s)), s.state),
      serialize,
      hasWorkflowChanged,
      oracle: 'P2',
    }),
  P3: (s) => {
    const run = sourceRun(s)
    return idempotence({
      oracle: 'P3',
      value: run.printed.files[0].text,
      step: () =>
        run.compiled.workflow ? printText(run.compiled.workflow, 'inline').files[0].text : '',
    })
  },
  P4: (s) => assertNoErrors(sourceRun(s).compiled.diagnostics),
  P5: (s) => {
    const run = sourceRun(s)
    return idempotence({
      oracle: 'P5',
      value: compiledOrThrow(run.compiled),
      step: () => compiledWorkflow(run.canonical, 'files'),
      equals: canonicalEquals,
    })
  },
  P6: (s) =>
    assertNoopIdentity({
      oracle: 'P6',
      original: s.state,
      materialized: materialized(compiledOrThrow(sourceRun(s).compiled), s.state),
    }),
  P7: (s) => {
    const run = sourceRun(s)
    const written = materialize(compiledOrThrow(run.compiled), null, {
      catalog,
      hooks,
      prev: s.state,
      resources: CORPUS_RESOURCES,
      lockFreshness: 'none',
    }).workflow
    return assertNoopDiff(
      diffCanonical(run.canonical, { ...written, meta: run.canonical.meta }, new Map())
    )
  },
  O1: (s) =>
    assertNoopIdentity({
      original: s.state,
      materialized: materialized(canonical(s), s.state),
    }),
  O2: (s) =>
    executionParity({
      original: withoutLockHeldState(s.state, catalog),
      candidate: withoutLockHeldState(materialized(canonical(s)), catalog),
      serialize,
      hasWorkflowChanged,
    }),
  O3: (s) =>
    idempotence({
      oracle: 'O3',
      value: canonical(s),
      step: (c) =>
        canonicalize(materialized(c, s.state), {
          catalog,
          meta: c.meta,
          resources: CORPUS_RESOURCES,
        }).workflow,
      equals: canonicalEquals,
    }),
}

const PROPERTY_TITLES: Record<ProofProperty, string> = {
  P0: 'P0 source fidelity: compile(print(c)) runs as c (executable view)',
  P1: 'P1 fidelity: canonicalize(materialize(compile(print(c)), prev)) runs as c',
  P2: 'P2 serializer parity after a full source round trip',
  P3: 'P3 print idempotence: print(compile(print(c))) is byte-identical',
  P4: 'P4 printed code compiles with zero errors',
  P5: 'P5 files mode compiles to the same workflow as inline mode',
  P6: 'P6 no-op apply: materialize(compile(print(c)), prev x) deep-equals x',
  P7: 'P7 unchanged source diffs as a no-op: diffCanonical(c, materialize(compile(print(c)), prev x)).noop',
  O1: 'O1 no-op identity: materialize(canonicalize(x), prev x) deep-equals x',
  O2: 'O2 lockless execution parity',
  O3: 'O3 idempotence: canonicalize(materialize(c)) equals c',
}

describe(`round-trip corpus (${subjects.length} workflows)`, () => {
  for (const property of Object.keys(PROPERTY_TITLES) as ProofProperty[]) {
    it(
      PROPERTY_TITLES[property],
      () => {
        const failed: string[] = []
        for (const subject of subjects) {
          const started = performance.now()
          if (subject.unknownTypes && SERIALIZING_PROPERTIES.has(property)) {
            report.record({
              caseId: subject.id,
              blockTypes: subject.blockTypes,
              property,
              status: 'skipped',
              durationMs: 0,
            })
            continue
          }
          try {
            const result = properties[property](subject)
            if (!result.ok) failed.push(subject.id)
            report.record({
              caseId: subject.id,
              blockTypes: subject.blockTypes,
              property,
              status: result.ok ? 'passed' : 'failed',
              durationMs: Math.round(performance.now() - started),
              ...(result.ok ? {} : { differences: result.differences }),
            })
          } catch (error) {
            failed.push(subject.id)
            report.record({
              caseId: subject.id,
              blockTypes: subject.blockTypes,
              property,
              status: 'errored',
              durationMs: Math.round(performance.now() - started),
              message: getErrorMessage(error, String(error)),
            })
          }
        }
        expect(failed.sort(compareStrings)).toEqual([])
      },
      corpusBudgetMs(subjects.length, PROPERTY_BUDGET_MS)
    )
  }

  it(
    'compiles every printed registry case without placing a value where it does not apply',
    () => {
      const misplaced = subjects
        .filter((subject) => REGISTRY_CASE.test(subject.id))
        .flatMap((subject) =>
          sourceRun(subject)
            .compiled.diagnostics.filter((d) => d.code === 'W_FIELD_NOT_APPLICABLE')
            .map((d) => `${subject.id}: ${d.param}`)
        )
      expect(misplaced).toEqual([])
    },
    corpusBudgetMs(subjects.length, PROPERTY_BUDGET_MS)
  )

  it(
    'applies printed source as a new workflow, then re-applies it as a no-op',
    () => {
      const notNoop: string[] = []
      let applied = 0
      for (const subject of subjects) {
        if (subject.unknownTypes) continue
        const [entry, ...codeFiles] = sourceRun(subject).printed.files
        const files = new Map(codeFiles.map((file) => [file.path, file.text]))
        const first = compileWorkflow({ entry, files, catalog, sdkMajor: catalog.sdkMajor })
        // `stored()` keeps a value only a stored workflow holds; a fresh apply refuses it.
        if (!first.workflow || first.diagnostics.some((d) => d.severity === 'error')) continue
        applied++
        const stored = materialized(first.workflow)
        const base = canonicalize(stored, {
          catalog,
          meta: first.workflow.meta,
          resources: CORPUS_RESOURCES,
        }).workflow
        const again = compileWorkflow({
          entry,
          files,
          catalog,
          sdkMajor: catalog.sdkMajor,
          knownKeys: new Set(Object.keys(base.blocks)),
          stored: base,
        })
        if (!again.workflow) {
          notNoop.push(`${subject.id}: re-compile failed`)
          continue
        }
        const written = materialize(again.workflow, null, {
          catalog,
          hooks,
          prev: stored,
          resources: CORPUS_RESOURCES,
          lockFreshness: 'none',
        })
        const diff = diffCanonical(base, { ...written.workflow, meta: base.meta }, new Map())
        const identity = assertNoopIdentity({ original: stored, materialized: written.state })
        if (!diff.noop || !identity.ok) notNoop.push(subject.id)
      }
      expect(applied).toBeGreaterThan(subjects.length / 2)
      expect(notNoop).toEqual([])
    },
    corpusBudgetMs(subjects.length, PROPERTY_BUDGET_MS)
  )

  it.each(generateRejectedCorpus())('rejects $id with $code instead of round-tripping', (c) => {
    const subject: ProofSubject = { id: c.id, blockTypes: [], state: c.state }
    const codes = sourceRun(subject).compiled.diagnostics.map((d) => d.code)
    expect(codes).toContain(c.code)
  })

  it('writes the report when a report path is set', () => {
    const target = process.env[reportPathVariable(SUITE)]
    const built = report.build({ generatedAt: new Date().toISOString() })
    expect(built.caseCount + built.skippedProperties.length).toBeGreaterThan(0)
    if (!target) return
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(
      target,
      `${JSON.stringify({ ...built, workflowCount: subjects.length }, null, 2)}\n`
    )
  })
})
