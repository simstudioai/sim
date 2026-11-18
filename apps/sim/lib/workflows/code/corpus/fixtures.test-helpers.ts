/**
 * The real-state corpora that live in this public repo: the landing-page
 * templates and the states `@sim/testing` builds. Agent-authored states from the private copilot
 * repo and anything exported from production stay out of the repo; `scripts/export-redacted-
 * workflows.ts` writes redacted production states to a directory outside it, and a caller points
 * the harness there with `ROUNDTRIP_CORPUS_EXTRA_DIR`.
 *
 * Test-only: it imports `@sim/testing` (a devDependency) and reads the filesystem.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { WorkflowBuilder } from '@sim/testing/builders'
import {
  createComplexWorkflowState,
  createConditionalWorkflowState,
  createLoopWorkflowState,
  createMinimalWorkflowState,
} from '@sim/testing/factories'
import { isRecordLike, omit } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import {
  type BlockCatalog,
  type CatalogSubBlock,
  canonicalize,
  catalogBlock,
  type ResourceKeyResolver,
} from '@sim/workflow-code'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import fc from 'fast-check'
import {
  type CorpusCase,
  DEFAULT_CORPUS_SEED,
  generateRegistryCorpus,
} from '@/lib/workflows/code/corpus'
import { workflowStateArbitrary } from '@/lib/workflows/code/corpus/proof'
import { CORPUS_SKILL } from '@/lib/workflows/code/corpus/values'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface FixtureState {
  /** `<source>:<name>`, stable across runs. */
  id: string
  state: WorkflowState
}

const LANDING_TEMPLATES_DIR = path.resolve(process.cwd(), 'public/landing-page-templates')

/**
 * Reads exported workflow files (`{ version, exportedAt, state }` or a bare state) from a directory.
 */
function loadWorkflowStatesFromDirectory(directory: string, source: string): FixtureState[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort(compareStrings)
    .map((file) => {
      const parsed: unknown = JSON.parse(readFileSync(path.join(directory, file), 'utf8'))
      return {
        id: `${source}:${file.replace(/\.json$/, '')}`,
        state: toWorkflowState(parsed, file),
      }
    })
}

function toWorkflowState(parsed: unknown, file: string): WorkflowState {
  const envelope = parsed && typeof parsed === 'object' && 'state' in parsed ? parsed.state : parsed
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    !('blocks' in envelope) ||
    !('edges' in envelope)
  ) {
    throw new Error(`${file} is not an exported workflow state`)
  }
  const state = envelope as WorkflowState
  return { ...state, loops: state.loops ?? {}, parallels: state.parallels ?? {} }
}

/** The 11 landing-page templates in `public/landing-page-templates`. */
function loadLandingTemplateStates(): FixtureState[] {
  return loadWorkflowStatesFromDirectory(LANDING_TEMPLATES_DIR, 'landing-template')
}

type FactoryOutput = Omit<WorkflowState, 'parallels'> & {
  parallels?: WorkflowState['parallels']
  isDeployed?: boolean
}

/** Drops the builder's wall-clock and deploy fields, which are not part of a stored graph. */
function stored(state: FactoryOutput): WorkflowState {
  const graph = omit(state, ['lastSaved', 'isDeployed'])
  return { ...graph, parallels: graph.parallels ?? {} }
}

/** States from the shared `@sim/testing` factories and builder presets. */
function buildTestingFactoryStates(): FixtureState[] {
  const fixtures: Array<[string, FactoryOutput]> = [
    ['minimal', createMinimalWorkflowState()],
    ['conditional', createConditionalWorkflowState()],
    ['loop', createLoopWorkflowState()],
    ['complex', createComplexWorkflowState()],
    ['builder-linear', WorkflowBuilder.linear(5).build()],
    ['builder-branching', WorkflowBuilder.branching().build()],
    ['builder-loop', WorkflowBuilder.withLoop(4).build()],
    ['builder-parallel', WorkflowBuilder.withParallel(3).build()],
  ]
  return fixtures.map(([name, state]) => ({ id: `testing:${name}`, state: stored(state) }))
}

/** One workflow a corpus property runs against. */
/** Corpus ids that name a deleted resource, which stays unresolved. */
const DELETED_SUFFIX = '-deleted'

/** Whether the corpus workspace holds a resource with this id (and key: the two are equal). */
function inCorpusWorkspace(value: string): boolean {
  return value.startsWith('corpus-') && !value.endsWith(DELETED_SUFFIX)
}

/**
 * The workspace the round-trip harness resolves resources in: every resource the corpus stores
 * (`corpus-*`: credentials, tables, knowledge bases, workflows, skills…) under a key equal to its
 * id, so selector fields print as `credential('…')`, `table('…')` and the like and write back
 * through the resolver. A deleted resource (`*-deleted`) and any id from outside the corpus stay
 * unresolved, as they would in a workspace that lacks them.
 */
export const CORPUS_RESOURCES: ResourceKeyResolver = {
  toKey: (_kind, id) => (inCorpusWorkspace(id) ? id : null),
  toId: (_kind, key) => (inCorpusWorkspace(key) ? key : null),
  nameOf: (kind, id) => (kind === 'skill' && id === CORPUS_SKILL.id ? CORPUS_SKILL.name : null),
}

export interface ProofSubject {
  id: string
  blockTypes: string[]
  state: WorkflowState
  /** Set on corpus cases whose types the registry does not know; the serializer rejects them. */
  unknownTypes?: true
}

/**
 * A state as the normalized tables hold it. Every write path recomputes the loops and parallels
 * maps from the container blocks (`prepareWorkflowStateForPersistence`, and
 * `saveWorkflowToNormalizedTables` writes `workflow_subflows` rows from
 * `generateLoopBlocks(blocks)`), so a map entry whose id has no container block (the pre-container
 * shape the `@sim/testing` loop factory still builds) is never stored and never loaded. Entries of
 * existing containers are kept as written.
 */
function persistedShape(state: WorkflowState): WorkflowState {
  const containers = (type: string) =>
    new Set(
      Object.values(state.blocks)
        .filter((block) => block.type === type)
        .map((block) => block.id)
    )
  const loopIds = containers('loop')
  const parallelIds = containers('parallel')
  return {
    ...state,
    loops: Object.fromEntries(Object.entries(state.loops ?? {}).filter(([id]) => loopIds.has(id))),
    parallels: Object.fromEntries(
      Object.entries(state.parallels ?? {}).filter(([id]) => parallelIds.has(id))
    ),
  }
}

function fixtureSubject(fixture: FixtureState): ProofSubject {
  const blockTypes = [...new Set(Object.values(fixture.state.blocks).map((b) => b.type))].sort(
    compareStrings
  )
  return { id: fixture.id, blockTypes, state: persistedShape(fixture.state) }
}

/** Corpus kinds that hold one block type's subject; every other kind is structural. */
const PER_BLOCK_KINDS: ReadonlySet<CorpusCase['kind']> = new Set([
  'operation',
  'trigger',
  'standalone-advanced',
  'error-edge',
])

/**
 * Every structural case, plus the first `perType` per-block cases of each block type, or of each
 * block type and kind when `byKind`.
 */
export function sampleCorpus(
  corpus: CorpusCase[],
  { perType, byKind = false }: { perType: number; byKind?: boolean }
): CorpusCase[] {
  const counts = new Map<string, number>()
  return corpus.filter((corpusCase) => {
    if (!PER_BLOCK_KINDS.has(corpusCase.kind)) return true
    const [, type = ''] = corpusCase.id.split(':')
    const slot = byKind ? `${corpusCase.kind}:${type}` : type
    const count = counts.get(slot) ?? 0
    if (count >= perType) return false
    counts.set(slot, count + 1)
    return true
  })
}

/** Per-block corpus cases each corpus property keeps per block type, unless the run is full. */
const CASES_PER_BLOCK_TYPE = 3
const FUZZ_RUNS = 50

/**
 * Every workflow a corpus property runs against: the generated registry corpus (sampled unless
 * `ROUNDTRIP_CORPUS_FULL=1`), the landing templates, the `@sim/testing` states, redacted production
 * states from `ROUNDTRIP_CORPUS_EXTRA_DIR`, and fast-check workflows, each in the shape the
 * normalized tables store.
 */
export function corpusSubjects(): ProofSubject[] {
  const generated = generateRegistryCorpus()
  const extraDir = process.env.ROUNDTRIP_CORPUS_EXTRA_DIR
  const corpus: ProofSubject[] = (
    process.env.ROUNDTRIP_CORPUS_FULL === '1'
      ? generated
      : sampleCorpus(generated, { perType: CASES_PER_BLOCK_TYPE })
  ).map((corpusCase) => ({
    id: corpusCase.id,
    blockTypes: corpusCase.blockTypes,
    state: persistedShape(corpusCase.state),
    ...(corpusCase.unknownTypes && { unknownTypes: true as const }),
  }))
  return [
    ...corpus,
    ...loadLandingTemplateStates().map(fixtureSubject),
    ...buildTestingFactoryStates().map(fixtureSubject),
    ...(extraDir ? loadWorkflowStatesFromDirectory(extraDir, 'redacted').map(fixtureSubject) : []),
    ...fc
      .sample(workflowStateArbitrary({ maxBlocks: 8, maxDepth: 2 }), {
        numRuns: FUZZ_RUNS,
        seed: DEFAULT_CORPUS_SEED,
      })
      .map((state, i) => fixtureSubject({ id: `fuzz:${i}`, state })),
  ]
}

/**
 * Wall time one corpus property may take, by corpus size. Measured on the full corpus (EC2,
 * 17,043 workflows): the slowest properties (P0, which pays for the shared print and compile, then
 * P1, P2, P3 and P5) took 164–184 s, about 11 ms per workflow, so each workflow is allowed
 * `PER_CASE_MS`, roughly twice that. The reduced default corpus stays under `floorMs`, its CI
 * budget, and `CAP_MS` bounds a runaway full run.
 */
const PER_CASE_MS = 20
const CAP_MS = 900_000

/** The timeout of one corpus property over `caseCount` workflows, never under `floorMs`. */
export function corpusBudgetMs(caseCount: number, floorMs = 60_000): number {
  return Math.min(CAP_MS, Math.max(floorMs, caseCount * PER_CASE_MS))
}

/** Item keys canonicalize drops by design, by structured kind. */
const DROPPED_ITEM_KEYS: Record<string, string[]> = {
  inputFormat: ['id', 'collapsed'],
  tableRows: ['id'],
  tools: ['isExpanded'],
}

function stripItems(value: unknown, keys: string[]): unknown {
  if (!Array.isArray(value)) return value
  return value.map((item) => (isRecordLike(item) ? omit(item, keys) : item))
}

/**
 * A structured value decoded from JSON text. Whether a list is stored as text or natively is
 * storage encoding, which the CWM does not carry: a write with no prev uses
 * the catalog `storage`, and branch lists are always repaired to text.
 */
function decodedStructured(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/**
 * Every string inside `value` with block reference prefixes in normalized form
 * (`<Email Drafter.body>` → `<emaildrafter.body>`), the form canonicalize writes. The block
 * resolver looks names up normalized (`BlockResolver`), so both forms
 * resolve to the same block.
 */
function normalizedReferences(value: unknown, keys: ReadonlySet<string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/<([^<>.]+)\./g, (match: string, prefix: string) => {
      const key = normalizeWorkflowBlockName(prefix)
      return keys.has(key) ? `<${key}.` : match
    })
  }
  if (Array.isArray(value)) return value.map((item) => normalizedReferences(item, keys))
  if (!isRecordLike(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [key, normalizedReferences(member, keys)])
  )
}

/**
 * The modes each block runs with, as one explicit map: the effective mode of every pair
 * canonicalize resolves, plus each tool's as `${i}:cid`. Explicit entries equal to the effective
 * mode select the same members, so swapping them in changes nothing the serializer does.
 */
function effectiveModeMaps(
  state: WorkflowState,
  catalog: BlockCatalog
): Map<string, Record<string, 'basic' | 'advanced'>> {
  const { workflow, identity } = canonicalize(state, {
    catalog,
    meta: { name: '', description: null },
  })
  const maps = new Map<string, Record<string, 'basic' | 'advanced'>>()
  for (const [key, block] of Object.entries(workflow.blocks)) {
    const modes: Record<string, 'basic' | 'advanced'> = { ...block.modes }
    for (const param of Object.values(block.params)) {
      if (param.kind !== 'tools') continue
      param.tools.forEach((tool, index) => {
        for (const [id, mode] of Object.entries(tool.modes)) modes[`${index}:${id}`] = mode
      })
    }
    maps.set(identity.blocks[key].id, modes)
  }
  return maps
}

/** A switch's `'true'`/`'false'` or a slider's decimal text, as the value it spells. */
function typedLegacyText(declared: CatalogSubBlock | undefined, value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (declared?.valueKind === 'boolean' && (value === 'true' || value === 'false')) {
    return value === 'true'
  }
  if (declared?.valueKind === 'number' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

/**
 * A state without what a lockless write with no prev cannot know and what never changes what runs:
 * item ids and editor flags canonicalize drops (inputFormat field ids live in the lock's `items`;
 * table row ids, `collapsed` and `isExpanded` are editor state), layout (`horizontalHandles`,
 * container sizes), which lives in the lock's `layout`, and `null` subBlocks, which the serializer
 * reads like absent ones (`params[id] == null`). Structured values compare decoded, and a tool with
 * no `params` reads like one with `{}` (canonicalize lifts both to `{}`). Edge handles left unset
 * read as the default `source` / `target` handles. Stored `canonicalModes` are replaced by the
 * effective modes: a stale entry for a pair the block no longer has, or an explicit entry equal to
 * inference, selects nothing different. Reference prefixes compare normalized, as canonicalize
 * writes them. A switch or slider holding its legacy text (`'true'`, `'0.7'`) reads as the boolean or
 * number it spells: a lockless write has no prev text to keep. O2 compares through this: its candidate is written with no lock and no prev.
 */
export function withoutLockHeldState(state: WorkflowState, catalog: BlockCatalog): WorkflowState {
  const modes = effectiveModeMaps(state, catalog)
  const blocks: WorkflowState['blocks'] = {}
  for (const [id, block] of Object.entries(state.blocks)) {
    const subBlocks: WorkflowState['blocks'][string]['subBlocks'] = {}
    for (const [subBlockId, subBlock] of Object.entries(block.subBlocks ?? {})) {
      if (subBlock?.value === null || subBlock?.value === undefined) continue
      const declared = catalogBlock(catalog, block.type)?.subBlocks.find((s) => s.id === subBlockId)
      const keys = declared?.structured ? DROPPED_ITEM_KEYS[declared.structured] : undefined
      if (!declared?.structured) {
        const value = typedLegacyText(declared, subBlock.value)
        subBlocks[subBlockId] = { ...subBlock, value: value as typeof subBlock.value }
        continue
      }
      let value = decodedStructured(subBlock.value)
      if (keys) value = stripItems(value, keys)
      if (declared.structured === 'tools' && Array.isArray(value)) {
        value = value.map((tool) =>
          isRecordLike(tool) && tool.params === undefined ? { ...tool, params: {} } : tool
        )
      }
      subBlocks[subBlockId] = { ...subBlock, value: value as typeof subBlock.value }
    }
    blocks[id] = {
      ...omit(block, ['horizontalHandles']),
      subBlocks,
      data: { ...omit(block.data ?? {}, ['width', 'height']), canonicalModes: modes.get(id) ?? {} },
    }
  }
  const keys = new Set(
    Object.values(state.blocks).map((block) => normalizeWorkflowBlockName(block.name))
  )
  const edges = state.edges.map((edge) => ({
    ...edge,
    sourceHandle: edge.sourceHandle ?? 'source',
    targetHandle: edge.targetHandle ?? 'target',
  }))
  return normalizedReferences({ ...state, blocks, edges }, keys) as WorkflowState
}
