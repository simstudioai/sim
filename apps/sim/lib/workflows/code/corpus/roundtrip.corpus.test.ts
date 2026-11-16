/**
 * The round-trip harness (DESIGN.md "Proof") over every corpus: the generated
 * registry corpus, the landing templates, the `@sim/testing` states, redacted production states
 * from `ROUNDTRIP_CORPUS_EXTRA_DIR` (written outside the repo by
 * scripts/export-redacted-workflows.ts), and fast-check workflows.
 *
 * It imports every engine (catalog, canonicalize, print, compile, equivalence, materialize and the
 * server's materialize hooks) statically and builds the real catalog from the live registry.
 *
 * CI budget (under 60 s): by default every block type keeps up to `CASES_PER_BLOCK_TYPE` cases
 * plus every structural case; `ROUNDTRIP_CORPUS_FULL=1` runs the whole corpus. Set
 * `ROUNDTRIP_CORPUS_REPORT_PATH` to write the JSON report (per-block-type parity).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/registry')

import { getErrorMessage } from '@sim/utils/errors'
import { compareStrings } from '@sim/utils/string'
import {
  type BlockCatalog,
  type CanonicalWorkflow,
  type CompileResult,
  canonicalEquals,
  canonicalize,
  compileWorkflow,
  executableView,
  materialize,
  printWorkflow,
} from '@sim/workflow-code'
import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { generateRejectedCorpus } from '@/lib/workflows/code/corpus'
import {
  corpusBudgetMs,
  type ProofSubject,
  roundTripSubjects,
  withoutLockHeldState,
} from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import {
  assertNoErrors,
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
import { getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'
import { Serializer } from '@/serializer'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const SUITE = 'roundtrip-corpus'
const CASES_PER_BLOCK_TYPE = 3
const FUZZ_RUNS = 50
/**
 * One property over the reduced default corpus. The first property to run pays for the shared
 * source run (canonicalize, print, compile per workflow); the whole file stays inside the 60 s CI
 * budget. This is the floor of `corpusBudgetMs`, which scales the timeout with the corpus size,
 * so `ROUNDTRIP_CORPUS_FULL=1` gets a per-workflow allowance instead of this constant.
 */
const PROPERTY_BUDGET_MS = 30_000

const hooks = createMaterializeHooks()

const catalog = buildBlockCatalog({
  blocks: Object.values(getBlockRegistry()),
  trigger: registryTrigger,
  sdkNames: SDK_NAMES,
})

/** Properties that serialize the original, which an unknown block type makes throw. */
const SERIALIZING_PROPERTIES: ReadonlySet<ProofProperty> = new Set(['P2', 'O2'])

const subjects: ProofSubject[] = roundTripSubjects({
  casesPerBlockType: CASES_PER_BLOCK_TYPE,
  full: process.env.ROUNDTRIP_CORPUS_FULL === '1',
  fuzzRuns: FUZZ_RUNS,
  extraDir: process.env.ROUNDTRIP_CORPUS_EXTRA_DIR,
})

const report = createProofReport(SUITE)

/** What every property runs against. */
interface ResolvedEngines {
  catalog: BlockCatalog
}

const engines: ResolvedEngines = { catalog }

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

function sourceRun(e: ResolvedEngines, subject: ProofSubject): SourceRun {
  const cached = sourceRuns.get(subject)
  if (cached) return cached
  const workflow = canonicalize(subject.state, {
    catalog: e.catalog,
    meta: { name: subject.id, description: null },
  }).workflow
  const printed = printText(e, workflow, 'inline')
  const run = {
    canonical: workflow,
    printed,
    compiled: compileFiles(e, printed, workflow),
  }
  sourceRuns.set(subject, run)
  return run
}

function canonical(e: ResolvedEngines, subject: ProofSubject): CanonicalWorkflow {
  return sourceRun(e, subject).canonical
}

function compiledOrThrow(compiled: CompileResult): CanonicalWorkflow {
  if (!compiled.workflow) {
    throw new Error(`compile failed: ${compiled.diagnostics.map((d) => d.code).join(', ')}`)
  }
  return compiled.workflow
}

function printText(e: ResolvedEngines, workflow: CanonicalWorkflow, mode: 'inline' | 'files') {
  return printWorkflow({
    workflow,
    catalog: e.catalog,
    options: { functionCode: mode },
  })
}

/**
 * The keys the stored workflow binds to ids, as the lock (or the lock assembled from
 * source meta) carries them. They let a printed `meta.key` keep a legacy collision key or a
 * reserved name through compile.
 */
function storedKeys(workflow: CanonicalWorkflow): ReadonlySet<string> {
  return new Set(Object.keys(workflow.blocks))
}

/** Compiles a print of `stored` as apply does: against the stored keys and values it continues. */
function compileFiles(
  e: ResolvedEngines,
  printed: ReturnType<typeof printWorkflow>,
  stored: CanonicalWorkflow
) {
  const [entry, ...codeFiles] = printed.files
  return compileWorkflow({
    entry,
    files: new Map(codeFiles.map((file) => [file.path, file.text])),
    catalog: e.catalog,
    sdkMajor: e.catalog.sdkMajor,
    knownKeys: storedKeys(stored),
    stored,
  })
}

function compiledWorkflow(
  e: ResolvedEngines,
  workflow: CanonicalWorkflow,
  mode: 'inline' | 'files' = 'inline'
) {
  return compiledOrThrow(compileFiles(e, printText(e, workflow, mode), workflow))
}

function materialized(e: ResolvedEngines, workflow: CanonicalWorkflow, prev?: WorkflowState) {
  return materialize(workflow, null, {
    catalog: e.catalog,
    hooks,
    prev,
    lockFreshness: 'none',
  }).state
}

const properties: Record<ProofProperty, (e: ResolvedEngines, s: ProofSubject) => OracleResult> = {
  P0: (e, s) =>
    idempotence({
      oracle: 'P0',
      value: executableView(canonical(e, s), e.catalog),
      step: () => executableView(compiledOrThrow(sourceRun(e, s).compiled), e.catalog),
    }),
  P1: (e, s) => {
    const original = canonical(e, s)
    return idempotence({
      oracle: 'P1',
      value: executableView(original, e.catalog),
      step: () =>
        executableView(
          canonicalize(materialized(e, compiledWorkflow(e, original), s.state), {
            catalog: e.catalog,
            meta: original.meta,
          }).workflow,
          e.catalog
        ),
    })
  },
  P2: (e, s) =>
    executionParity({
      original: s.state,
      candidate: materialized(e, compiledWorkflow(e, canonical(e, s)), s.state),
      serialize,
      hasWorkflowChanged,
      oracle: 'P2',
    }),
  P3: (e, s) => {
    const run = sourceRun(e, s)
    return idempotence({
      oracle: 'P3',
      value: run.printed.files[0].text,
      step: () =>
        run.compiled.workflow ? printText(e, run.compiled.workflow, 'inline').files[0].text : '',
    })
  },
  P4: (e, s) => assertNoErrors(sourceRun(e, s).compiled.diagnostics),
  P5: (e, s) => {
    const run = sourceRun(e, s)
    return idempotence({
      oracle: 'P5',
      value: compiledOrThrow(run.compiled),
      step: () => compiledWorkflow(e, run.canonical, 'files'),
      equals: canonicalEquals,
    })
  },
  P6: (e, s) =>
    assertNoopIdentity({
      oracle: 'P6',
      original: s.state,
      materialized: materialized(e, compiledOrThrow(sourceRun(e, s).compiled), s.state),
    }),
  O1: (e, s) =>
    assertNoopIdentity({
      original: s.state,
      materialized: materialized(e, canonical(e, s), s.state),
    }),
  O2: (e, s) =>
    executionParity({
      original: withoutLockHeldState(s.state, e.catalog),
      candidate: withoutLockHeldState(materialized(e, canonical(e, s)), e.catalog),
      serialize,
      hasWorkflowChanged,
    }),
  O3: (e, s) =>
    idempotence({
      oracle: 'O3',
      value: canonical(e, s),
      step: (c) =>
        canonicalize(materialized(e, c, s.state), { catalog: e.catalog, meta: c.meta }).workflow,
      equals: canonicalEquals,
    }),
}

/**
 * Stored shapes no source form expresses yet. Every property that goes through print and compile
 * must fail on exactly these and pass everywhere else: a new failure or a newly passing case fails
 * the run. The report still records each as failed. Empty since legacy name collisions and
 * reserved names print as `meta.key`, which compiles against the stored keys. The O
 * oracles never print, so they must pass on these too.
 */
const KNOWN_FAILURES: Record<string, string> = {}
const KNOWN_FAILURE_IDS = Object.keys(KNOWN_FAILURES).sort(compareStrings)
const SOURCE_FREE_PROPERTIES: ReadonlySet<ProofProperty> = new Set(['O1', 'O2', 'O3'])

/**
 * Stored shapes a lockless write with no prev cannot reproduce for O2, because the CWM holds no
 * node for them. O2 must fail on exactly these, besides `KNOWN_FAILURES` for source properties.
 * Empty since canonicalize reads the loop count that runs (`block.data.count || 5`, never a count
 * only the loops map holds) and the subjects take the stored shape, where every loops-map entry
 * has its container block.
 */
const KNOWN_O2_FAILURES: Record<string, string> = {}

function expectedFailures(property: ProofProperty): string[] {
  if (property === 'O2') return Object.keys(KNOWN_O2_FAILURES).sort(compareStrings)
  return SOURCE_FREE_PROPERTIES.has(property) ? [] : KNOWN_FAILURE_IDS
}

const PROPERTY_TITLES: Record<ProofProperty, string> = {
  P0: 'P0 source fidelity: compile(print(c)) runs as c (executable view)',
  P1: 'P1 fidelity: canonicalize(materialize(compile(print(c)), prev)) runs as c',
  P2: 'P2 serializer parity after a full source round trip',
  P3: 'P3 print idempotence: print(compile(print(c))) is byte-identical',
  P4: 'P4 printed code compiles with zero errors',
  P5: 'P5 files mode compiles to the same workflow as inline mode',
  P6: 'P6 no-op apply: materialize(compile(print(c)), prev x) deep-equals x',
  O1: 'O1 no-op identity: materialize(canonicalize(x), prev x) deep-equals x',
  O2: 'O2 lockless execution parity',
  O3: 'O3 idempotence: canonicalize(materialize(c)) equals c',
}

describe(`round-trip corpus (${subjects.length} workflows)`, () => {
  for (const property of Object.keys(PROPERTY_TITLES) as ProofProperty[]) {
    it(
      PROPERTY_TITLES[property],
      () => {
        const e = engines
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
            const result = properties[property](e, subject)
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
        expect(failed.sort(compareStrings)).toEqual(expectedFailures(property))
      },
      corpusBudgetMs(subjects.length, PROPERTY_BUDGET_MS)
    )
  }

  it.each(generateRejectedCorpus())('rejects $id with $code instead of round-tripping', (c) => {
    const subject: ProofSubject = { id: c.id, blockTypes: [], state: c.state }
    const codes = sourceRun(engines, subject).compiled.diagnostics.map((d) => d.code)
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
