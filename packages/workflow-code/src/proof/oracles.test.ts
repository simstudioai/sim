import type { WorkflowState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { findDifferences } from './diff'
import {
  assertNoopIdentity,
  executionParity,
  idempotence,
  type SerializedWorkflowLike,
} from './oracles'

function conditionWorkflow(
  ids: {
    start: string
    cond: string
    target: string
    rowIf: string
    rowElse: string
    edge: string
  },
  conditions: unknown
): WorkflowState {
  return {
    blocks: {
      [ids.start]: {
        id: ids.start,
        type: 'start_trigger',
        name: 'Start',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      },
      [ids.cond]: {
        id: ids.cond,
        type: 'condition',
        name: 'Route It',
        position: { x: 1, y: 0 },
        subBlocks: {
          conditions: {
            id: 'conditions',
            type: 'condition-input',
            value: conditions as WorkflowState['blocks'][string]['subBlocks'][string]['value'],
          },
        },
        outputs: {},
        enabled: true,
      },
      [ids.target]: {
        id: ids.target,
        type: 'function',
        name: 'After',
        position: { x: 2, y: 0 },
        subBlocks: { code: { id: 'code', type: 'code', value: 'return <routeit.result>' } },
        outputs: {},
        enabled: true,
        data: { parentId: undefined },
      },
    },
    edges: [
      { id: `${ids.edge}-a`, source: ids.start, target: ids.cond, sourceHandle: 'source' },
      {
        id: `${ids.edge}-b`,
        source: ids.cond,
        target: ids.target,
        sourceHandle: `condition-${ids.rowIf}`,
      },
    ],
    loops: {},
    parallels: {},
  }
}

const originalIds = {
  start: 'aaaaaaaa-0000-4000-8000-000000000001',
  cond: 'aaaaaaaa-0000-4000-8000-000000000002',
  target: 'aaaaaaaa-0000-4000-8000-000000000003',
  rowIf: 'aaaaaaaa-0000-4000-8000-0000000000a1',
  rowElse: 'aaaaaaaa-0000-4000-8000-0000000000a2',
  edge: 'aaaaaaaa-0000-4000-8000-0000000000e0',
}
const freshIds = {
  start: 'bbbbbbbb-0000-4000-8000-000000000001',
  cond: 'bbbbbbbb-0000-4000-8000-000000000002',
  target: 'bbbbbbbb-0000-4000-8000-000000000003',
  rowIf: 'bbbbbbbb-0000-4000-8000-0000000000a1',
  rowElse: 'bbbbbbbb-0000-4000-8000-0000000000a2',
  edge: 'bbbbbbbb-0000-4000-8000-0000000000e0',
}

const rows = (ids: typeof originalIds, expression: string) => [
  { id: ids.rowIf, title: 'if', value: expression },
  { id: ids.rowElse, title: 'else', value: '' },
]

/** A serializer stand-in that exposes exactly what the real one forwards: ids, params, handles. */
function serialize(state: WorkflowState): SerializedWorkflowLike {
  return {
    blocks: Object.values(state.blocks).map((block) => ({
      id: block.id,
      enabled: block.enabled,
      config: {
        tool: block.type,
        params: Object.fromEntries(
          Object.entries(block.subBlocks).map(([id, subBlock]) => [id, subBlock.value])
        ),
      },
    })),
    connections: state.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  }
}

const unchanged = () => false

describe('findDifferences', () => {
  it('treats an own key holding undefined as different from an absent key', () => {
    expect(findDifferences({ a: 1 }, { a: 1, b: undefined })).toEqual([
      { path: '/b', kind: 'unexpected', actual: 'undefined' },
    ])
  })

  it('ignores object key order but not array order', () => {
    expect(findDifferences({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([])
    expect(findDifferences([1, 2], [2, 1]).map((d) => d.path)).toEqual(['/0', '/1'])
  })

  it('escapes pointer segments', () => {
    expect(findDifferences({ 'a/b~c': 1 }, { 'a/b~c': 2 })[0]?.path).toBe('/a~1b~0c')
  })
})

describe('assertNoopIdentity (O1)', () => {
  it('fails a materialize that re-encodes a JSON-string value as an array', () => {
    const original = conditionWorkflow(originalIds, JSON.stringify(rows(originalIds, 'x > 1')))
    const reencoded = conditionWorkflow(originalIds, rows(originalIds, 'x > 1'))
    const result = assertNoopIdentity({ original, materialized: reencoded })
    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.differences.map((d) => d.path)).toEqual([
      `/blocks/${originalIds.cond}/subBlocks/conditions/value`,
    ])
  })
})

describe('executionParity (O2)', () => {
  it('passes a lockless round trip with fresh block, row and edge ids and a new encoding', () => {
    const original = conditionWorkflow(originalIds, JSON.stringify(rows(originalIds, 'x > 1')))
    const candidate = conditionWorkflow(freshIds, rows(freshIds, 'x > 1'))
    expect(
      executionParity({ original, candidate, serialize, hasWorkflowChanged: unchanged })
    ).toEqual({
      ok: true,
      oracle: 'O2',
    })
  })

  it('fails when a branch expression changed', () => {
    const original = conditionWorkflow(originalIds, JSON.stringify(rows(originalIds, 'x > 1')))
    const candidate = conditionWorkflow(freshIds, rows(freshIds, 'x > 2'))
    const result = executionParity({
      original,
      candidate,
      serialize,
      hasWorkflowChanged: unchanged,
    })
    expect(result.ok).toBe(false)
  })

  it('fails when an edge moved to another branch', () => {
    const original = conditionWorkflow(originalIds, JSON.stringify(rows(originalIds, 'x > 1')))
    const candidate = conditionWorkflow(freshIds, rows(freshIds, 'x > 1'))
    const moved = {
      ...candidate,
      edges: candidate.edges.map((edge) =>
        edge.sourceHandle === `condition-${freshIds.rowIf}`
          ? { ...edge, sourceHandle: `condition-${freshIds.rowElse}` }
          : edge
      ),
    }
    const result = executionParity({
      original,
      candidate: moved,
      serialize,
      hasWorkflowChanged: unchanged,
    })
    expect(result.ok ? [] : result.differences.map((d) => d.path)).toEqual(['/connections/1'])
  })

  it('fails when change detection reports a change', () => {
    const original = conditionWorkflow(originalIds, JSON.stringify(rows(originalIds, 'x > 1')))
    const result = executionParity({
      original,
      candidate: original,
      serialize,
      hasWorkflowChanged: () => true,
    })
    expect(result.ok ? [] : result.differences.map((d) => d.path)).toEqual(['/hasWorkflowChanged'])
  })
})

describe('idempotence (O3, P3)', () => {
  it('reports the first differing line of a printed file', () => {
    const result = idempotence({
      oracle: 'P3',
      value: 'a\nb\nc',
      step: (text) => text.replace('b', 'B'),
    })
    expect(result).toEqual({
      ok: false,
      oracle: 'P3',
      differences: [{ path: 'line:2', kind: 'text', expected: '"b"', actual: '"B"' }],
    })
  })

  it('defers to the supplied equality for structured values', () => {
    const value = { blocks: {}, annotations: { comments: { header: [] } } }
    const result = idempotence({
      oracle: 'O3',
      value,
      step: () => ({ blocks: {}, annotations: { comments: {} } }),
      equals: (a, b) => JSON.stringify(a.blocks) === JSON.stringify(b.blocks),
    })
    expect(result.ok).toBe(true)
  })
})
