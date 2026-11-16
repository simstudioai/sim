/**
 * The Wave 3 round-trip harness (s3 §5 P1–P5, s1 §6 O1–O3) over every corpus: the generated
 * registry corpus, the landing templates, the `@sim/testing` states, redacted production states
 * from `ROUNDTRIP_CORPUS_EXTRA_DIR` (written outside the repo by
 * scripts/export-redacted-workflows.ts), and fast-check workflows.
 *
 * It is written against the `api.ts` function types and reads the real engines from
 * `@sim/workflow-code` at run time. Until an engine lands, each property that needs it is
 * registered as a skipped test whose title names the missing export or module, and the report
 * lists it under `skippedProperties`. Wave 3 replaces the run-time lookups with static imports
 * and removes the skips.
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
import type {
  BlockCatalog,
  CanonicalEqualsFn,
  CanonicalizeFn,
  CanonicalWorkflow,
  CompileWorkflowFn,
  MaterializeFn,
  MaterializeHooks,
  PrintWorkflowFn,
} from '@sim/workflow-code'
import * as workflowCode from '@sim/workflow-code'
import {
  assertNoErrors,
  assertNoopIdentity,
  createProofReport,
  executionParity,
  findDifferences,
  idempotence,
  type OracleResult,
  type ProofProperty,
  reportPathVariable,
  withoutAnnotations,
  workflowStateArbitrary,
} from '@sim/workflow-code/proof'
import fc from 'fast-check'
import { type CorpusCase, generateRegistryCorpus } from '@/lib/workflows/code/corpus'
import {
  buildTestingFactoryStates,
  type FixtureState,
  loadLandingTemplateStates,
  loadWorkflowStatesFromDirectory,
} from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import { hasWorkflowChanged } from '@/lib/workflows/comparison/compare'
import { Serializer } from '@/serializer'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const SUITE = 'roundtrip-corpus'
const CASES_PER_BLOCK_TYPE = 3
const FUZZ_RUNS = 50

interface Engines {
  canonicalize: CanonicalizeFn
  materialize: MaterializeFn
  compileWorkflow: CompileWorkflowFn
  printWorkflow: PrintWorkflowFn
  canonicalEquals: CanonicalEqualsFn
}

type EngineName = keyof Engines

const packageExports: Record<string, unknown> = { ...workflowCode }

function engine<K extends EngineName>(name: K): Engines[K] | null {
  const value = packageExports[name]
  return typeof value === 'function' ? (value as Engines[K]) : null
}

/**
 * Loads a server module that does not exist before Wave 3 without failing the file's transform.
 * Resolves `null` when the module or the export is missing.
 */
async function optionalExport(specifier: string, name: string): Promise<unknown> {
  try {
    const mod: Record<string, unknown> = await import(/* @vite-ignore */ specifier)
    return mod[name] ?? null
  } catch {
    return null
  }
}

const CATALOG_MODULE = '@/lib/workflows/code/catalog'
const CATALOG_EXPORT = 'buildCodeCatalog'
const HOOKS_MODULE = '@/lib/workflows/code/materialize-hooks'
const HOOKS_EXPORT = 'createMaterializeHooks'

const buildCatalog = await optionalExport(CATALOG_MODULE, CATALOG_EXPORT)
const createHooks = await optionalExport(HOOKS_MODULE, HOOKS_EXPORT)

const catalog: BlockCatalog | null =
  typeof buildCatalog === 'function' ? (buildCatalog({}).catalog as BlockCatalog) : null
const hooks: MaterializeHooks | null =
  typeof createHooks === 'function' ? (createHooks() as MaterializeHooks) : null

const PROPERTY_NEEDS: Record<ProofProperty, Array<EngineName | 'catalog' | 'hooks'>> = {
  P1: ['catalog', 'hooks', 'canonicalize', 'printWorkflow', 'compileWorkflow', 'materialize'],
  P2: ['catalog', 'hooks', 'canonicalize', 'printWorkflow', 'compileWorkflow', 'materialize'],
  P3: ['catalog', 'canonicalize', 'printWorkflow', 'compileWorkflow'],
  P4: ['catalog', 'canonicalize', 'printWorkflow', 'compileWorkflow'],
  P5: ['catalog', 'canonicalize', 'printWorkflow', 'compileWorkflow'],
  O1: ['catalog', 'hooks', 'canonicalize', 'materialize'],
  O2: ['catalog', 'hooks', 'canonicalize', 'materialize'],
  O3: ['catalog', 'hooks', 'canonicalize', 'materialize'],
}

function missingFor(property: ProofProperty): string[] {
  return PROPERTY_NEEDS[property].flatMap((need) => {
    if (need === 'catalog') return catalog ? [] : [`${CATALOG_MODULE}#${CATALOG_EXPORT} (Wave 2A)`]
    if (need === 'hooks') return hooks ? [] : [`${HOOKS_MODULE}#${HOOKS_EXPORT} (Wave 3)`]
    return engine(need) ? [] : [`@sim/workflow-code#${need}`]
  })
}

interface ProofSubject {
  id: string
  blockTypes: string[]
  state: WorkflowState
}

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

/** The engines with every needed one present; only called after `missingFor` came back empty. */
type ResolvedEngines = Engines & { catalog: BlockCatalog; hooks: MaterializeHooks }

function resolveEngines(): ResolvedEngines {
  const found = {
    canonicalize: engine('canonicalize'),
    materialize: engine('materialize'),
    compileWorkflow: engine('compileWorkflow'),
    printWorkflow: engine('printWorkflow'),
    canonicalEquals: engine('canonicalEquals'),
  }
  if (!catalog) throw new Error('catalog missing')
  return {
    canonicalize: found.canonicalize ?? missingEngine('canonicalize'),
    materialize: found.materialize ?? missingEngine('materialize'),
    compileWorkflow: found.compileWorkflow ?? missingEngine('compileWorkflow'),
    printWorkflow: found.printWorkflow ?? missingEngine('printWorkflow'),
    canonicalEquals:
      found.canonicalEquals ??
      ((a, b) => findDifferences(withoutAnnotations(a), withoutAnnotations(b)).length === 0),
    catalog,
    hooks: hooks ?? missingHooks(),
  }
}

function missingEngine(name: string): never {
  throw new Error(`@sim/workflow-code#${name} is not implemented`)
}

function missingHooks(): never {
  throw new Error(`${HOOKS_MODULE}#${HOOKS_EXPORT} is not implemented`)
}

const serializer = new Serializer()
const serialize = (state: WorkflowState) =>
  serializer.serializeWorkflow(state.blocks, state.edges, state.loops, state.parallels)

function canonical(e: ResolvedEngines, subject: ProofSubject): CanonicalWorkflow {
  return e.canonicalize(subject.state, {
    catalog: e.catalog,
    meta: { name: subject.id, description: null },
  }).workflow
}

function printText(e: ResolvedEngines, workflow: CanonicalWorkflow, mode: 'inline' | 'files') {
  return e.printWorkflow({
    workflow,
    catalog: e.catalog,
    options:
      mode === 'files' ? { functionCode: 'files', codeDir: 'code' } : { functionCode: 'inline' },
  })
}

function compileFiles(e: ResolvedEngines, printed: ReturnType<PrintWorkflowFn>) {
  const [entry, ...codeFiles] = printed.files
  return e.compileWorkflow({
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
  const compiled = compileFiles(e, printText(e, workflow, mode))
  if (!compiled.workflow) {
    throw new Error(`compile failed: ${compiled.diagnostics.map((d) => d.code).join(', ')}`)
  }
  return compiled.workflow
}

function materialized(e: ResolvedEngines, workflow: CanonicalWorkflow, prev?: WorkflowState) {
  return e.materialize(workflow, null, {
    catalog: e.catalog,
    hooks: e.hooks,
    prev,
    lockFreshness: 'none',
  }).state
}

const properties: Record<ProofProperty, (e: ResolvedEngines, s: ProofSubject) => OracleResult> = {
  P1: (e, s) => {
    const original = canonical(e, s)
    return idempotence({
      oracle: 'P1',
      value: original,
      step: (c) =>
        e.canonicalize(materialized(e, compiledWorkflow(e, c), s.state), {
          catalog: e.catalog,
          meta: c.meta,
        }).workflow,
      equals: e.canonicalEquals,
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
  P3: (e, s) =>
    idempotence({
      oracle: 'P3',
      value: printText(e, canonical(e, s), 'inline').files[0].text,
      step: (text) => {
        const compiled = e.compileWorkflow({
          entry: { path: 'workflow.ts', text },
          files: new Map(),
          catalog: e.catalog,
          sdkMajor: e.catalog.sdkMajor,
        })
        return compiled.workflow ? printText(e, compiled.workflow, 'inline').files[0].text : ''
      },
    }),
  P4: (e, s) =>
    assertNoErrors(compileFiles(e, printText(e, canonical(e, s), 'inline')).diagnostics),
  P5: (e, s) => {
    const c = canonical(e, s)
    return idempotence({
      oracle: 'P5',
      value: compiledWorkflow(e, c, 'inline'),
      step: () => compiledWorkflow(e, c, 'files'),
      equals: e.canonicalEquals,
    })
  },
  O1: (e, s) =>
    assertNoopIdentity({
      original: s.state,
      materialized: materialized(e, canonical(e, s), s.state),
    }),
  O2: (e, s) =>
    executionParity({
      original: s.state,
      candidate: materialized(e, canonical(e, s)),
      serialize,
      hasWorkflowChanged,
    }),
  O3: (e, s) =>
    idempotence({
      oracle: 'O3',
      value: canonical(e, s),
      step: (c) =>
        e.canonicalize(materialized(e, c, s.state), { catalog: e.catalog, meta: c.meta }).workflow,
      equals: e.canonicalEquals,
    }),
}

const PROPERTY_TITLES: Record<ProofProperty, string> = {
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
    const missing = missingFor(property)
    if (missing.length > 0) {
      const reason = `missing ${missing.join(', ')}`
      report.skipProperty(property, reason)
      it.skip(`${PROPERTY_TITLES[property]} [SKIPPED until Wave 3: ${reason}]`, () => {})
      continue
    }

    it(PROPERTY_TITLES[property], () => {
      const e = resolveEngines()
      let failed = 0
      for (const subject of subjects) {
        const started = performance.now()
        try {
          const result = properties[property](e, subject)
          if (!result.ok) failed += 1
          report.record({
            caseId: subject.id,
            blockTypes: subject.blockTypes,
            property,
            status: result.ok ? 'passed' : 'failed',
            durationMs: Math.round(performance.now() - started),
            ...(result.ok ? {} : { differences: result.differences }),
          })
        } catch (error) {
          failed += 1
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
      expect(failed).toBe(0)
    })
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
