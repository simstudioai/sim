/**
 * A param omitted in source means its editor default, which compile seeds into the new block. The
 * seeded value is stored as is, so it has to be the value the field's own type stores: the apply
 * gate (`normalizeChangedValues`) refuses a switch holding `"true"` and rewrites a slider holding
 * `"0.7"`, which would make a block created from source fail or differ from one made on the canvas.
 */
import {
  canonicalize,
  catalogBlock,
  catalogBlockTypes,
  compileWorkflow,
  diffCanonical,
  materialize,
  printWorkflow,
  sourceFingerprint,
} from '@sim/workflow-code'
import { editorDefaults } from '@sim/workflow-code/catalog/defaults'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import { normalizeChangedValues } from '@/lib/workflows/application/source-locate'
import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { validateValueForSubBlockType } from '@/lib/workflows/editing/validation'
import { getBlockRegistry } from '@/blocks/registry'

const hooks = createMaterializeHooks()

/** Compiles `body` into a new workflow and materializes it with no stored state. */
function createNew(body: string): WorkflowState {
  const compiled = compileWorkflow({
    entry: {
      path: 'workflow.ts',
      text: [
        `// @sim-sdk ${catalog.sdkMajor}`,
        "import { block, file, workflow } from '@sim/workflow-sdk'",
        '',
        "export default workflow('Seeded', {}, () => {",
        `  ${body}`,
        '})',
        '',
      ].join('\n'),
    },
    files: new Map(),
    catalog,
    sdkMajor: catalog.sdkMajor,
  })
  const errors = compiled.diagnostics.filter((d) => d.severity === 'error')
  if (!compiled.workflow || errors.length > 0) {
    throw new Error(errors.map((d) => `${d.code}: ${d.message}`).join('; '))
  }
  return materialize(compiled.workflow, null, { catalog, hooks, lockFreshness: 'none' }).state
}

/** Compiles `body` into a new workflow and runs the apply gate's value checks on every block. */
function applyNew(body: string) {
  const { blocks } = createNew(body)
  const gated = normalizeChangedValues(
    blocks,
    { added: Object.keys(blocks), removed: [], modified: [], edgesAdded: [], edgesRemoved: [] },
    (id) => id
  )
  const [block] = Object.values(blocks)
  return {
    findings: gated.diagnostics.map((d) => `${d.code}:${d.param ?? ''}`),
    value: (id: string) => block.subBlocks[id]?.value,
  }
}

describe('a block created from source passes the apply gate on its seeded defaults', () => {
  it('creates file.read with its Include Subfolders switch on', () => {
    const applied = applyNew("file.read('Read', { readFileInput: 'wf_abc' })")
    expect(applied.findings).toEqual([])
    expect(applied.value('folderIncludeSubfolders')).toBe(true)
  })

  it('seeds a switch that defaults off as false', () => {
    const applied = applyNew("block('tinybird', 'Events', { operation: 'tinybird_events' })")
    expect(applied.findings).toEqual([])
    expect(applied.value('wait')).toBe(false)
  })

  it('seeds a slider as a number, so nothing is normalized', () => {
    const applied = applyNew("block('perplexity', 'Ask', { content: 'hi' })")
    expect(applied.findings).toEqual([])
    expect(applied.value('temperature')).toBe(0.7)
  })
})

describe('every editor default in the registry is a value its field stores', () => {
  it('validates unchanged against its subBlock type, for every block', () => {
    const registry = getBlockRegistry()
    const problems: string[] = []
    for (const type of catalogBlockTypes(catalog)) {
      const block = catalogBlock(catalog, type)
      const config = registry[type]
      if (!block || !config) continue
      for (const [id, seeded] of editorDefaults(block)) {
        const declaration = config.subBlocks.find((subBlock) => subBlock.id === id)
        if (!declaration) continue
        const result = validateValueForSubBlockType(declaration, seeded, id, block.type, 'b')
        if (!result.valid) {
          problems.push(`${block.type}.${id}: ${result.error?.error}`)
        } else if (result.value !== seeded) {
          problems.push(
            `${block.type}.${id}: ${declaration.type} stores ${JSON.stringify(result.value)}, seeded ${JSON.stringify(seeded)}`
          )
        }
      }
    }
    expect(problems).toEqual([])
  })
})

const META = { name: 'Legacy', description: null }

/** Get then apply: prints `stored`, compiles the print (after `edit`) and writes it over `stored`. */
function getThenApply(stored: WorkflowState, edit: (text: string) => string = (text) => text) {
  const before = canonicalize(stored, { catalog, meta: META })
  const [entry] = printWorkflow({
    workflow: before.workflow,
    catalog,
    options: { functionCode: 'inline' },
  }).files
  const compiled = compileWorkflow({
    entry: { path: entry.path, text: edit(entry.text) },
    files: new Map(),
    catalog,
    sdkMajor: catalog.sdkMajor,
    knownKeys: new Set(Object.keys(before.workflow.blocks)),
    stored: before.workflow,
  })
  if (!compiled.workflow) throw new Error(compiled.diagnostics.map((d) => d.code).join(', '))
  const written = materialize(compiled.workflow, null, {
    catalog,
    hooks,
    prev: stored,
    lockFreshness: 'none',
  })
  const after = canonicalize(written.state, { catalog, meta: META })
  return {
    text: entry.text,
    diagnostics: [...before.diagnostics, ...compiled.diagnostics].map((d) => d.code),
    noop: diffCanonical(before.workflow, written.workflow, new Map()).noop,
    state: written.state,
    fingerprints: [before, after].map((c) => sourceFingerprint(c.workflow, c.identity)),
  }
}

/** A workflow stored before switches and sliders were seeded typed, holding their old text. */
function legacyWorkflow(include: string, temperature: string): WorkflowState {
  const state = createNew(
    "file.read('Read', { readFileInput: 'wf_abc' })\n  block('perplexity', 'Ask', { content: 'hi', apiKey: '{{PERPLEXITY_API_KEY}}' })"
  )
  const read = Object.values(state.blocks).find((b) => b.type === 'file_v5')
  const ask = Object.values(state.blocks).find((b) => b.type === 'perplexity')
  if (!read?.subBlocks.folderIncludeSubfolders || !ask?.subBlocks.temperature) {
    throw new Error('fixture blocks are missing their legacy fields')
  }
  read.subBlocks.folderIncludeSubfolders.value = include
  ask.subBlocks.temperature.value = temperature
  return state
}

const storedValue = (state: WorkflowState, type: string, id: string) =>
  Object.values(state.blocks).find((b) => b.type === type)?.subBlocks[id]?.value

describe('a workflow stored with the old text defaults', () => {
  it('reads as its defaults and re-applies as a no-op that keeps the stored text', () => {
    const stored = legacyWorkflow('true', '0.7')
    const run = getThenApply(stored)
    expect(run.diagnostics).toEqual([])
    expect(run.text).not.toContain('folderIncludeSubfolders')
    expect(run.text).not.toContain('temperature')
    expect(run.noop).toBe(true)
    expect(run.state).toEqual(stored)
    expect(run.fingerprints[1]).toBe(run.fingerprints[0])
  })

  it('prints a non-default text value the way the typed value prints', () => {
    const stored = legacyWorkflow('false', '1.0')
    const run = getThenApply(stored)
    expect(run.diagnostics).toEqual([])
    expect(run.text).toContain('folderIncludeSubfolders: false')
    expect(run.text).toContain('temperature: 1')
    expect(run.state).toEqual(stored)
  })

  it('writes the typed value once the field is edited, and leaves the other text alone', () => {
    const run = getThenApply(legacyWorkflow('true', '0.7'), (text) =>
      text.replace(
        "readFileInput: 'wf_abc'",
        "readFileInput: 'wf_abc', folderIncludeSubfolders: false"
      )
    )
    expect(run.diagnostics).toEqual([])
    expect(storedValue(run.state, 'file_v5', 'folderIncludeSubfolders')).toBe(false)
    expect(storedValue(run.state, 'perplexity', 'temperature')).toBe('0.7')
  })
})
