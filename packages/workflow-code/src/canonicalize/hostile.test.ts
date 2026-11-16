import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { compileWorkflow } from '../compile'
import { canonicalEquals } from '../equivalence'
import { catalog } from '../print/__fixtures__/catalog'
import { printWorkflow } from '../print/printer'
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
    expect(Object.hasOwn(call.opaque?.data ?? {}, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(call.opaque?.data ?? {}, '__proto__')?.value).toEqual({
      kept: true,
    })
  })
})
