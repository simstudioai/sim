/**
 * The Wave 3 round-trip harness (s3 §5 P1–P5, s1 §6 O1–O3) over every corpus: the generated
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
  materialize,
  type PrintWorkflowFn,
  printWorkflow,
} from '@sim/workflow-code'
import {
  assertNoErrors,
  assertNoopIdentity,
  createProofReport,
  executionParity,
  idempotence,
  type OracleResult,
  type ProofProperty,
  reportPathVariable,
  workflowStateArbitrary,
} from '@sim/workflow-code/proof'
import fc from 'fast-check'
import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { type CorpusCase, generateRegistryCorpus } from '@/lib/workflows/code/corpus'
import {
  buildTestingFactoryStates,
  type FixtureState,
  loadLandingTemplateStates,
  loadWorkflowStatesFromDirectory,
  withoutLockHeldState,
} from '@/lib/workflows/code/corpus/fixtures.test-helpers'
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
 * One property over the default corpus. The first property to run pays for the shared source run
 * (canonicalize, print, compile per workflow); the whole file stays inside the 60 s CI budget.
 */
const PROPERTY_BUDGET_MS = 30_000

const hooks = createMaterializeHooks()

const { catalog } = buildBlockCatalog({
  blocks: Object.values(getBlockRegistry()),
  trigger: registryTrigger,
  sdkNames: SDK_NAMES,
})

interface ProofSubject {
  id: string
  blockTypes: string[]
  state: WorkflowState
  /** Set on corpus cases whose types the registry does not know; the serializer rejects them. */
  unknownTypes?: true
}

/** Properties that serialize the original, which an unknown block type makes throw. */
const SERIALIZING_PROPERTIES: ReadonlySet<ProofProperty> = new Set(['P2', 'O2'])

function toSubject(fixture: FixtureState): ProofSubject {
  const blockTypes = [...new Set(Object.values(fixture.state.blocks).map((b) => b.type))].sort()
  return { id: fixture.id, blockTypes, state: fixture.state }
}

/** Every structural case, plus up to `CASES_PER_BLOCK_TYPE` per-block cases for each type. */
function budgetedCorpus(corpus: CorpusCase[]): CorpusCase[] {
  if (process.env.ROUNDTRIP_CORPUS_FULL === '1') return corpus
  const perType = new Map<string, number>()
  return corpus.filter((corpusCase) => {
    const [, type = ''] = corpusCase.id.split(':')
    const isPerBlock = ['operation', 'trigger', 'standalone-advanced', 'error-edge'].includes(
      corpusCase.kind
    )
    if (!isPerBlock) return true
    const count = perType.get(type) ?? 0
    if (count >= CASES_PER_BLOCK_TYPE) return false
    perType.set(type, count + 1)
    return true
  })
}

const subjects: ProofSubject[] = [
  ...budgetedCorpus(generateRegistryCorpus()),
  ...loadLandingTemplateStates().map(toSubject),
  ...buildTestingFactoryStates().map(toSubject),
  ...(process.env.ROUNDTRIP_CORPUS_EXTRA_DIR
    ? loadWorkflowStatesFromDirectory(process.env.ROUNDTRIP_CORPUS_EXTRA_DIR, 'redacted').map(
        toSubject
      )
    : []),
  ...fc
    .sample(workflowStateArbitrary({ maxBlocks: 8, maxDepth: 2 }), {
      numRuns: FUZZ_RUNS,
      seed: 20261115,
    })
    .map((state, i) => toSubject({ id: `fuzz:${i}`, state })),
]

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
  printed: ReturnType<PrintWorkflowFn>
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
  const run = { canonical: workflow, printed, compiled: compileFiles(e, printed) }
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
    options:
      mode === 'files' ? { functionCode: 'files', codeDir: 'code' } : { functionCode: 'inline' },
  })
}

function compileFiles(e: ResolvedEngines, printed: ReturnType<PrintWorkflowFn>) {
  const [entry, ...codeFiles] = printed.files
  return compileWorkflow({
    entry,
    files: new Map(codeFiles.map((file) => [file.path, file.text])),
    catalog: e.catalog,
    sdkMajor: e.catalog.sdkMajor,
  })
}

function compiledWorkflow(
  e: ResolvedEngines,
  workflow: CanonicalWorkflow,
  mode: 'inline' | 'files' = 'inline'
) {
  return compiledOrThrow(compileFiles(e, printText(e, workflow, mode)))
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
      value: canonical(e, s),
      step: () => compiledOrThrow(sourceRun(e, s).compiled),
      equals: canonicalEquals,
    }),
  P1: (e, s) => {
    const original = canonical(e, s)
    return idempotence({
      oracle: 'P1',
      value: original,
      step: (c) =>
        canonicalize(materialized(e, compiledWorkflow(e, c), s.state), {
          catalog: e.catalog,
          meta: c.meta,
        }).workflow,
      equals: canonicalEquals,
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

const LEGACY_NAME_COLLISION =
  'two stored names normalize alike (E_CANON_LEGACY_NAME_COLLISION keys the second `name~2`); ' +
  'the source form cannot carry that key, so compile reports E_DUPLICATE_NAME (Wave 3: lock keys)'
const RESERVED_BLOCK_NAME =
  'a block named Loop or Parallel (W_CANON_RESERVED_NAME); compile reports E_RESERVED_NAME ' +
  '(Wave 3: decide the source form for legacy reserved names)'

/**
 * Stored shapes the editor and realtime persistence refuse (`getWorkflowBlockNameConflict`) but
 * legacy rows can hold, which no source form expresses yet. Every property that goes through
 * print and compile must fail on exactly these and pass everywhere else: a new failure or a newly
 * passing case fails the run. The report still records each as failed. The O oracles never print,
 * so they must pass on these too.
 */
const KNOWN_FAILURES: Record<string, string> = {
  'name-collision:function:Agent 1|agent1': LEGACY_NAME_COLLISION,
  'name-collision:function:Fetch  Data|fetch data': LEGACY_NAME_COLLISION,
  'name-collision:function:My.Block|myblock': LEGACY_NAME_COLLISION,
  'testing:builder-loop': RESERVED_BLOCK_NAME,
  'testing:builder-parallel': RESERVED_BLOCK_NAME,
}
const KNOWN_FAILURE_IDS = Object.keys(KNOWN_FAILURES).sort(compareStrings)
const SOURCE_FREE_PROPERTIES: ReadonlySet<ProofProperty> = new Set(['O1', 'O2', 'O3'])

/**
 * Stored shapes a lockless write with no prev cannot reproduce for O2, because the CWM holds no
 * node for them. O2 must fail on exactly these, besides `KNOWN_FAILURES` for source properties.
 */
const KNOWN_O2_FAILURES: Record<string, string> = {
  'testing:loop':
    'a loops-map entry with no loop block (the pre-container shape); the CWM has no block to ' +
    'carry it, so a write from scratch has no loop',
  'landing-template:meeting-followup-agent-a2357a2f-67f7-40c1-8e64-301bcd604239':
    'a loop whose block.data omits count while the loops map holds it; canonicalize reads the ' +
    'map, and a write from scratch puts count in block.data too (s1 materialize step 6)',
}

function expectedFailures(property: ProofProperty): string[] {
  if (property === 'O2') return Object.keys(KNOWN_O2_FAILURES).sort(compareStrings)
  return SOURCE_FREE_PROPERTIES.has(property) ? [] : KNOWN_FAILURE_IDS
}

const PROPERTY_TITLES: Record<ProofProperty, string> = {
  P0: 'P0 source fidelity: compile(print(c)) equals c',
  P1: 'P1 fidelity: canonicalize(materialize(compile(print(c)))) equals c',
  P2: 'P2 serializer parity after a full source round trip',
  P3: 'P3 print idempotence: print(compile(print(c))) is byte-identical',
  P4: 'P4 printed code compiles with zero errors',
  P5: 'P5 files mode compiles to the same workflow as inline mode',
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
      PROPERTY_BUDGET_MS
    )
  }

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
