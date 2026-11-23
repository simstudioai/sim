/**
 * A workflow built the way the editor and the API build one prints clean source, and that source
 * applies back unchanged as a no-op: the start block every new workflow is seeded with (one blank,
 * unnamed input row) and a function block added through the operations route.
 */

import { isRecordLike } from '@sim/utils/object'
import {
  canonicalize,
  compileWorkflow,
  diffCanonical,
  materialize,
  printWorkflow,
  sourceFingerprint,
} from '@sim/workflow-code'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { createBlockFromParams } from '@/lib/workflows/editing/builders'

const hooks = createMaterializeHooks()
const META = { name: 'Built', description: null }

/** A new workflow's seeded start block wired to a function block added through operations. */
function builtWorkflow(): WorkflowState {
  const { workflowState, startBlockId } = buildDefaultWorkflowArtifacts()
  const score = createBlockFromParams('score-block', {
    type: 'function',
    name: 'Score',
    inputs: { code: 'return 1' },
  })
  return {
    ...workflowState,
    blocks: { ...workflowState.blocks, [score.id]: { ...score, position: { x: 400, y: 0 } } },
    edges: [{ id: 'edge-1', source: startBlockId, target: score.id }],
  }
}

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
    errors: compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code),
    noop: diffCanonical(before.workflow, written.workflow, new Map()).noop,
    state: written.state,
    fingerprints: [before, after].map((c) => sourceFingerprint(c.workflow, c.identity)),
  }
}

describe('a workflow built by the editor and the API', () => {
  it('prints the seeded start block without its blank, unnamed input row', () => {
    const run = getThenApply(builtWorkflow())
    expect(run.errors).toEqual([])
    expect(run.text).toContain("trigger.start('Start', { inputFormat: {}, runMetadata: false })")
  })

  it('prints a function block added through operations without a language', () => {
    expect(getThenApply(builtWorkflow()).text).toContain("fn('Score', { code: js`return 1` })")
  })

  it('applies its printed source back as a no-op that keeps the stored state byte for byte', () => {
    const stored = builtWorkflow()
    const run = getThenApply(stored)
    expect(run.noop).toBe(true)
    expect(JSON.stringify(run.state)).toBe(JSON.stringify(stored))
    expect(run.fingerprints[1]).toBe(run.fingerprints[0])
  })

  it('stores the field a person adds in source, and prints it back alone', () => {
    const added = getThenApply(builtWorkflow(), (text) =>
      text.replace('inputFormat: {}', "inputFormat: { email: 'string' }")
    )
    expect(added.errors).toEqual([])
    const start = Object.values(added.state.blocks).find((b) => b.type === 'start_trigger')
    const fields: unknown = start?.subBlocks.inputFormat?.value
    const names = Array.isArray(fields)
      ? fields.map((field: unknown) => (isRecordLike(field) ? field.name : null))
      : null
    expect(names).toEqual(['email'])
    const reread = getThenApply(added.state)
    expect(reread.text).toContain("inputFormat: { email: 'string' }")
    expect(reread.noop).toBe(true)
  })

  it('prints a blank field beside named ones as stored, so the list the person shaped is kept', () => {
    const stored = builtWorkflow()
    const start = Object.values(stored.blocks).find((block) => block.type === 'start_trigger')
    const inputFormat = start?.subBlocks.inputFormat
    if (!inputFormat || !Array.isArray(inputFormat.value)) throw new Error('no inputFormat')
    Reflect.set(inputFormat, 'value', [
      ...inputFormat.value,
      { id: 'field-email', name: 'email', type: 'string', value: '' },
    ])
    const run = getThenApply(stored)
    expect(run.text).toContain("inputFormat: { '': 'string', email: 'string' }")
    expect(run.noop).toBe(true)
    expect(JSON.stringify(run.state)).toBe(JSON.stringify(stored))
  })
})
