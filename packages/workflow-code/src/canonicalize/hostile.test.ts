import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import {
  reindexCanonicalModesByPosition,
  scopeCanonicalModesForTool,
} from '../catalog/canonical-index'
import { compileWorkflow } from '../compile'
import { TEST_CATALOG as catalog } from '../compile/catalog.test-helpers'
import { canonicalEquals } from '../equivalence'
import type { WorkflowLockV1 } from '../lock'
import { materialize } from '../materialize'
import {
  blockState,
  CATALOG,
  draftOf,
  canonical as fixtureCanonical,
  fixtureHooks,
  workflowState,
} from '../materialize/fixtures.test-helpers'
import type { CanonicalBlock } from '../model'
import { printWorkflow } from '../print/printer'
import { setOwn } from '../records'
import { canonicalize } from '.'

/**
 * Stored names and keys that collide with `Object.prototype` members. A plain `record[key] = v`
 * write drops `__proto__` (it sets the prototype instead) and a plain read of an absent
 * `constructor` returns the inherited function, so each must survive canonicalize, print and
 * compile as data.
 */
const PROTOTYPE_NAMES = ['__proto__', 'constructor', 'prototype'] as const

function storedBlock(id: string, type: string, name: string, extra: Partial<BlockState> = {}) {
  return {
    id,
    type,
    name,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    ...extra,
  } as BlockState
}

function hostileState(): WorkflowState {
  const blocks: Record<string, BlockState> = {}
  const variables: Record<string, unknown> = {}
  Object.defineProperty(blocks, 'start', {
    value: storedBlock('start', 'start_trigger', 'Start'),
    enumerable: true,
  })
  const edges: WorkflowState['edges'] = []
  for (const name of PROTOTYPE_NAMES) {
    Object.defineProperty(blocks, name, {
      value: storedBlock(name, 'agent', name, {
        subBlocks: { model: { id: 'model', type: 'combobox', value: 'gpt-4o' } },
      }),
      enumerable: true,
    })
    edges.push({
      id: `edge-${name}`,
      source: 'start',
      target: name,
      sourceHandle: 'source',
      targetHandle: 'target',
    })
    Object.defineProperty(variables, name, {
      value: { id: name, name, type: 'string', value: `value of ${name}` },
      enumerable: true,
    })
  }
  return { blocks, edges, loops: {}, parallels: {}, variables } as unknown as WorkflowState
}

describe('canonicalize: prototype-named keys', () => {
  it('keeps blocks and variables named like Object.prototype members through print and compile', () => {
    const canonical = canonicalize(hostileState(), {
      catalog,
      meta: { name: 'Hostile', description: null },
    })
    for (const name of PROTOTYPE_NAMES) {
      expect(Object.hasOwn(canonical.workflow.blocks, name)).toBe(true)
      expect(Object.hasOwn(canonical.workflow.variables, name)).toBe(true)
      expect(Object.hasOwn(canonical.identity.blocks, name)).toBe(true)
      expect(Object.hasOwn(canonical.identity.variables, name)).toBe(true)
      expect(Object.hasOwn(canonical.layout, name)).toBe(true)
    }

    const printed = printWorkflow({
      workflow: canonical.workflow,
      catalog,
      options: { functionCode: 'inline' },
    })
    const entry = printed.files[0]
    const compiled = compileWorkflow({ entry, files: new Map(), catalog, sdkMajor: 1 })
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(compiled.workflow).not.toBeNull()
    if (!compiled.workflow) return
    expect(canonicalEquals(compiled.workflow, canonical.workflow)).toBe(true)
  })

  it('keeps a stored subBlock id and a data key named __proto__', () => {
    const subBlocks = JSON.parse(
      '{"__proto__":{"id":"__proto__","type":"short-input","value":"kept"}}'
    )
    const data = JSON.parse('{"__proto__":{"kept":true}}')
    const state = {
      blocks: {
        start: storedBlock('start', 'start_trigger', 'Start'),
        call: storedBlock('call', 'api', 'Call', { subBlocks, data }),
      },
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
    } as unknown as WorkflowState
    const canonical = canonicalize(state, {
      catalog,
      meta: { name: 'Hostile', description: null },
    })
    const call = canonical.workflow.blocks.call
    expect(Object.hasOwn(call.params, '__proto__')).toBe(true)
    expect(Object.hasOwn(call.extra ?? {}, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(call.extra ?? {}, '__proto__')?.value).toEqual({
      kept: true,
    })
  })
})

describe('stored canonicalModes keys named like prototype members', () => {
  it('scopes a nested tool mode keyed __proto__ as data', () => {
    const overrides = JSON.parse('{"0:__proto__":"advanced"}')
    const scoped = scopeCanonicalModesForTool(overrides, 0)
    expect(Object.getOwnPropertyDescriptor(scoped ?? {}, '__proto__')?.value).toBe('advanced')
  })

  it('carries a tool mode keyed __proto__ to its new position and keeps a legacy one', () => {
    const overrides = JSON.parse('{"1:__proto__":"advanced","__proto__":"basic"}')
    const moved = reindexCanonicalModesByPosition(new Map([[1, 0]]), overrides)
    expect(Object.getOwnPropertyDescriptor(moved ?? {}, '0:__proto__')?.value).toBe('advanced')
    expect(Object.getOwnPropertyDescriptor(moved ?? {}, '__proto__')?.value).toBe('basic')
  })
})

/** The own value at `key`; a plain read would return an inherited prototype member instead. */
function own(record: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value
}

describe('materialize: prototype-named keys', () => {
  it('writes a block keyed __proto__ into the state and the identity', () => {
    const prev = workflowState([blockState('b1', 'function', '__proto__', { code: 'return 1' })])
    const result = materialize(fixtureCanonical(prev).workflow, null, {
      catalog: CATALOG,
      hooks: fixtureHooks(),
      lockFreshness: 'none',
    })
    expect(Object.keys(result.identity.blocks)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(result.identity.blocks)).toBe(Object.prototype)
    expect(Object.keys(result.state.blocks)).toHaveLength(1)
  })

  it('keeps a __proto__ block in the written CWM while a rename is rewritten', () => {
    const prev = workflowState([
      blockState('b1', 'function', 'old', { code: 'return 1' }),
      blockState('b2', 'agent', '__proto__', { model: 'gpt-4o' }),
    ])
    const draft = draftOf(fixtureCanonical(prev).workflow)
    draft.blocks = Object.fromEntries(
      Object.entries(draft.blocks).map(([key, block]) =>
        key === 'old' ? ['renamed', { ...block, key: 'renamed', name: 'renamed' }] : [key, block]
      )
    )
    const result = materialize(draft, null, {
      catalog: CATALOG,
      hooks: fixtureHooks(),
      prev,
      lockFreshness: 'none',
    })
    expect(Object.keys(result.workflow.blocks).sort()).toEqual(['__proto__', 'renamed'])
    expect(Object.keys(result.state.blocks).sort()).toEqual(['b1', 'b2'])
  })

  it('writes a block whose lock id is __proto__', () => {
    const prev = workflowState([blockState('b1', 'function', 'fn', { code: 'return 1' })])
    const lock: WorkflowLockV1 = {
      version: 1,
      blocks: { fn: { id: '__proto__', parent: null, ident: 'fn', order: 0 } },
      variables: {},
    }
    const result = materialize(fixtureCanonical(prev).workflow, lock, {
      catalog: CATALOG,
      hooks: fixtureHooks(),
      lockFreshness: 'none',
    })
    expect(Object.keys(result.state.blocks)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(result.state.blocks)).toBe(Object.prototype)
    expect(own(result.identity.blocks, 'fn')).toMatchObject({ id: '__proto__' })
  })

  it('writes, adds and clears params named __proto__ and constructor', () => {
    const stored = blockState('b1', 'mystery', 'thing', { a: 'x' })
    setOwn(stored.subBlocks, '__proto__', { id: '__proto__', type: 'short-input', value: 'old' })
    const prev = workflowState([stored])
    const draft = draftOf(fixtureCanonical(prev).workflow)
    const params: CanonicalBlock['params'] = {}
    setOwn(params, '__proto__', { kind: 'value', value: 'new' })
    setOwn(params, 'constructor', { kind: 'value', value: 'added' })
    draft.blocks.thing.params = params
    const result = materialize(draft, null, {
      catalog: CATALOG,
      hooks: fixtureHooks(),
      prev,
      lockFreshness: 'none',
    })
    const subBlocks = result.state.blocks.b1.subBlocks
    expect(Object.getPrototypeOf(subBlocks)).toBe(Object.prototype)
    expect(own(subBlocks, '__proto__')).toEqual({
      id: '__proto__',
      type: 'short-input',
      value: 'new',
    })
    expect(own(subBlocks, 'constructor')).toEqual({
      id: 'constructor',
      type: 'short-input',
      value: 'added',
    })
    expect(own(subBlocks, 'a')).toEqual({ id: 'a', type: 'short-input', value: null })
  })

  it('gives branch keys named like prototype members their own row ids and handles', () => {
    const rows = [
      { id: 'r-if', title: 'if', value: 'a' },
      { id: 'r-else', title: 'else', value: '' },
    ]
    const prev = workflowState([
      blockState('c1', 'condition', 'cond', { conditions: JSON.stringify(rows) }),
      blockState('f1', 'function', 'fn', { code: 'return 1' }),
    ])
    const draft = draftOf(fixtureCanonical(prev).workflow)
    const branchKeys = ['constructor', 'toString', '__proto__', 'else']
    draft.blocks.cond.branches = {
      kind: 'condition',
      rows: branchKeys.map((key) => ({ key, value: key === 'else' ? '' : key })),
    }
    draft.edges = [
      { from: 'cond', port: { kind: 'branch', key: '__proto__' }, to: 'fn' },
      { from: 'cond', port: { kind: 'branch', key: 'valueOf' }, to: 'fn' },
    ]
    const result = materialize(draft, null, {
      catalog: CATALOG,
      hooks: fixtureHooks(),
      prev,
      lockFreshness: 'none',
    })
    const written = JSON.parse(String(result.state.blocks.c1.subBlocks.conditions.value))
    for (const row of written) expect(typeof row.id).toBe('string')
    const ids = result.identity.blocks.cond.branches ?? {}
    expect(Object.keys(ids)).toEqual(branchKeys)
    for (const key of branchKeys) expect(typeof own(ids, key)).toBe('string')
    expect(result.state.edges.map((stored) => stored.sourceHandle)).toEqual([
      `condition-${own(ids, '__proto__')}`,
      'condition-c1-valueOf',
    ])
  })
})
