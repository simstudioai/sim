import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workflows/application/read-workflow-lint', () => ({
  readWorkflowLint: { execute: vi.fn() },
}))

import { runEngine } from '@/lib/mothership/agent-cli/engines'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'
import { navigatePath } from '@/executor/variables/resolvers/reference'

function runtimeWith(responses: Record<string, unknown>): AgentCliRuntime {
  return {
    workspaceId: 'ws-1',
    userId: 'user-1',
    client: {
      request: async <T>(path: string): Promise<T> => {
        const hit = responses[path]
        if (hit === undefined) throw new Error(`Unexpected request: ${path}`)
        return hit as T
      },
    },
  }
}

const STATE_PATH = '/api/v2/workflows/wf-1/state'

const RUNS_PATH = '/api/v2/workflows/wf-1/runs'
const COUNT_ROWS_RUNS = {
  [RUNS_PATH]: {
    data: [
      { runId: 'run-1', status: 'completed' },
      { runId: 'run-2', status: 'completed' },
      { runId: 'run-3', status: 'completed' },
    ],
  },
  '/api/v2/logs/run-1': {
    data: {
      traceSpans: [{ name: 'Count rows', status: 'success', output: { result: { count: 6 } } }],
    },
  },
  // Nested under a parent span: the walk is recursive.
  '/api/v2/logs/run-2': {
    data: {
      traceSpans: [
        {
          name: 'Loop 1',
          children: [{ name: 'Count rows', status: 'success', output: { result: { count: 2 } } }],
        },
      ],
    },
  },
  // The block never executed in this run.
  '/api/v2/logs/run-3': { data: { traceSpans: [{ name: 'Other', output: {} }] } },
}

async function logsQuery(flags: Record<string, string>) {
  const result = await runEngine('logs query', ['wf-1'], runtimeWith(COUNT_ROWS_RUNS), {
    block: 'Count rows',
    ...flags,
  })
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout)
}

describe('logs query', () => {
  it('reads a field with no span-level head under output and reports the resolved path', async () => {
    const report = await logsQuery({ field: 'result.count' })
    expect(report.field).toBe('output.result.count')
    expect(report.fieldResolvedUnder).toBe('output')
    expect(report.rows.map((row: { value: unknown }) => row.value)).toEqual([6, 2, null])
    expect(report.rows[2]).toMatchObject({ runId: 'run-3', hits: 0, value: null })
    expect(report.rows[2].note).toBeUndefined()

    const explicit = await logsQuery({ field: 'output.result.count' })
    expect(explicit.field).toBe('output.result.count')
    expect(explicit.fieldResolvedUnder).toBeUndefined()
  })

  it('marks a matched span whose path resolves to nothing, distinct from a genuine null', async () => {
    const report = await logsQuery({ field: 'input.code' })
    expect(report.field).toBe('input.code')
    expect(report.fieldResolvedUnder).toBeUndefined()
    expect(report.rows[0]).toMatchObject({
      runId: 'run-1',
      hits: 1,
      value: null,
      note: 'path not found on span',
    })

    const missing = await logsQuery({ field: 'result.missing' })
    expect(missing.rows[0]).toMatchObject({ value: null, note: 'path not found on span' })
  })

  it('filters out runs the block never reached under --where, with the same output fallback', async () => {
    const report = await logsQuery({ where: 'result.count=6' })
    expect(report.where).toBe('output.result.count=6')
    expect(report.whereResolvedUnder).toBe('output')
    expect(report.filteredOut).toBe(2)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({ runId: 'run-1', hits: 1 })
  })
})

const WITHHELD_RUNS = {
  [RUNS_PATH]: {
    data: [
      { runId: 'run-1', status: 'completed' },
      { runId: 'run-2', status: 'completed' },
    ],
  },
  '/api/v2/logs/run-1': {
    data: {
      traceSpans: [{ name: 'Count rows', status: 'success', output: { result: { count: 6 } } }],
    },
  },
  // The log projection withheld this span's content; its structure survived.
  '/api/v2/logs/run-2': {
    data: {
      traceSpans: [{ name: 'Count rows', status: 'success', duration: 12, contentWithheld: true }],
    },
  },
}

async function logsQueryWithheld(flags: Record<string, string>) {
  const result = await runEngine('logs query', ['wf-1'], runtimeWith(WITHHELD_RUNS), {
    block: 'Count rows',
    ...flags,
  })
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout)
}

describe('logs query on a span whose content was withheld', () => {
  it('reports withheld content instead of a missing path, and counts it', async () => {
    const report = await logsQueryWithheld({ field: 'result.count' })
    expect(report.rows[0]).toMatchObject({ runId: 'run-1', value: 6 })
    expect(report.rows[1]).toMatchObject({ runId: 'run-2', hits: 1, value: null })
    expect(report.rows[1].note).not.toBe('path not found on span')
    expect(report.rows[1].note).toMatch(/withheld/)
    expect(report.contentWithheld).toBe(1)
  })

  it('still answers structural paths on a withheld span', async () => {
    const report = await logsQueryWithheld({ field: 'duration' })
    expect(report.rows[1]).toMatchObject({ runId: 'run-2', value: 12 })
    expect(report.rows[1].note).toBeUndefined()
    expect(report.contentWithheld).toBeUndefined()
  })

  it('keeps a withheld run under --where as unchecked, not as a match or filtered out', async () => {
    const report = await logsQueryWithheld({ where: 'result.count=6' })
    expect(report.filteredOut).toBe(0)
    expect(report.rows.map((row: { runId: string }) => row.runId)).toEqual(['run-1', 'run-2'])
    expect(report.rows[0].whereUnchecked).toBeUndefined()
    expect(report.rows[1].whereUnchecked).toBe(true)
    expect(report.whereUnchecked).toBe(1)
  })

  it('counts an unchecked --where apart from a withheld --field', async () => {
    const readableField = await logsQueryWithheld({ field: 'duration', where: 'result.count=6' })
    expect(readableField.rows[1]).toMatchObject({ runId: 'run-2', value: 12 })
    expect(readableField.rows[1].note).toMatch(/--where/)
    expect(readableField.whereUnchecked).toBe(1)
    expect(readableField.contentWithheld).toBeUndefined()

    const withheldField = await logsQueryWithheld({ where: 'result.count=6' })
    expect(withheldField.rows[1].note).toMatch(/value unknown/)
    expect(withheldField.whereUnchecked).toBe(1)
    expect(withheldField.contentWithheld).toBe(1)
  })
})

// The projection omits a content field whole, so a span marked for its `thinking`
// still carries an intact `output` whose missing keys are genuinely absent.
const PARTLY_WITHHELD_RUNS = {
  [RUNS_PATH]: {
    data: [
      { runId: 'run-1', status: 'completed' },
      { runId: 'run-2', status: 'completed' },
    ],
  },
  '/api/v2/logs/run-1': {
    data: {
      traceSpans: [
        {
          name: 'Router',
          status: 'success',
          output: { route: 'priority', thinking: 'not the omitted span thinking' },
          contentWithheld: true,
        },
      ],
    },
  },
  '/api/v2/logs/run-2': {
    data: {
      traceSpans: [
        {
          name: 'Router',
          status: 'success',
          output: { content: 'no route chosen' },
          toolCalls: [{ name: 'lookup' }],
          contentWithheld: true,
        },
      ],
    },
  },
}

async function logsQueryPartlyWithheld(flags: Record<string, string>) {
  const result = await runEngine('logs query', ['wf-1'], runtimeWith(PARTLY_WITHHELD_RUNS), {
    block: 'Router',
    ...flags,
  })
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout)
}

describe('logs query on a marked span whose read field is intact', () => {
  it('filters out a run whose intact output lacks the --where key', async () => {
    const report = await logsQueryPartlyWithheld({ where: 'output.route=priority' })
    expect(report.rows.map((row: { runId: string }) => row.runId)).toEqual(['run-1'])
    expect(report.filteredOut).toBe(1)
    expect(report.whereUnchecked).toBeUndefined()

    const viaFallback = await logsQueryPartlyWithheld({ where: 'route=priority' })
    expect(viaFallback.rows.map((row: { runId: string }) => row.runId)).toEqual(['run-1'])
    expect(viaFallback.filteredOut).toBe(1)
  })

  it('reports a key missing from intact output as not found, not withheld', async () => {
    const report = await logsQueryPartlyWithheld({ field: 'output.route' })
    expect(report.rows[1]).toMatchObject({
      runId: 'run-2',
      value: null,
      note: 'path not found on span',
    })
    expect(report.contentWithheld).toBeUndefined()
  })

  it('reports a path through an omitted field as withheld', async () => {
    const thinking = await logsQueryPartlyWithheld({ field: 'thinking' })
    expect(thinking.rows[0].note).toMatch(/value unknown/)
    expect(thinking.contentWithheld).toBe(2)

    const shadowed = await logsQueryPartlyWithheld({ field: 'thinking', where: 'route=priority' })
    expect(shadowed.rows[0]).toMatchObject({ runId: 'run-1', value: null })
    expect(shadowed.rows[0].note).toMatch(/value unknown/)
    expect(shadowed.fieldResolvedUnder).toBeUndefined()

    const toolInput = await logsQueryPartlyWithheld({ field: 'toolCalls.0.input.query' })
    expect(toolInput.rows[1].note).toMatch(/value unknown/)
    const toolMissing = await logsQueryPartlyWithheld({ field: 'toolCalls.3.input.query' })
    expect(toolMissing.rows[1].note).toBe('path not found on span')
  })
})

const DEPS_STATE = {
  blocks: {
    'trigger-1': { type: 'starter', name: 'Start' },
    fetch: { type: 'function', name: 'Fetch rows' },
    gate: { type: 'condition', name: 'Gate' },
    enrich: { type: 'workflow', name: 'Enrich' },
    target: {
      type: 'function',
      name: 'Summarize',
      subBlocks: {
        code: { value: 'return <fetchrows.result>.length + <enrich.result.data.total>' },
      },
    },
  },
  edges: [
    { id: 'e1', source: 'trigger-1', target: 'fetch', sourceHandle: 'source' },
    { id: 'e2', source: 'fetch', target: 'target', sourceHandle: 'source' },
    { id: 'e3', source: 'gate', target: 'target', sourceHandle: 'condition-true' },
    { id: 'e4', source: 'enrich', target: 'target', sourceHandle: 'source' },
    { id: 'e5', source: 'trigger-1', target: 'target', sourceHandle: 'source' },
    { id: 'e6', source: 'target', target: 'target', sourceHandle: 'source' },
  ],
}

describe('workflows deps', () => {
  it('stops reading a wide object when its traversal budget is exhausted', async () => {
    const value: Record<string, unknown> = {}
    for (let index = 0; index < 10_001; index++) {
      Object.defineProperty(value, String(index), {
        enumerable: true,
        get() {
          if (index === 10_000) throw new Error('Read beyond the traversal budget')
          return ''
        },
      })
    }
    const state = {
      ...DEPS_STATE,
      blocks: {
        ...DEPS_STATE.blocks,
        target: { ...DEPS_STATE.blocks.target, subBlocks: { code: { value } } },
      },
    }
    const result = await runEngine(
      'workflows deps',
      ['wf-1', 'target'],
      runtimeWith({ [STATE_PATH]: { data: state } }),
      {}
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/exceeds.*values/i)
    expect(result.stdout).toBe('')
  })

  it.each([
    { reason: 'text size', value: 'x'.repeat(1024 * 1024 + 1) },
    { reason: 'reference count', value: '<fetchrows.result>'.repeat(10_001) },
    { reason: 'nested value count', value: Array.from({ length: 10_001 }, () => '') },
    {
      reason: 'path depth',
      value: `<fetchrows.${Array.from({ length: 129 }, () => 'nested').join('.')}>`,
    },
  ])(
    'refuses excessive $reason instead of returning an incomplete dependency report',
    async ({ value }) => {
      const state = {
        ...DEPS_STATE,
        blocks: {
          ...DEPS_STATE.blocks,
          target: { ...DEPS_STATE.blocks.target, subBlocks: { code: { value } } },
        },
      }
      const result = await runEngine(
        'workflows deps',
        ['wf-1', 'target'],
        runtimeWith({ [STATE_PATH]: { data: state } }),
        {}
      )
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/exceeds|maximum/i)
      expect(result.stdout).toBe('')
    }
  )

  it('groups block aliases and duplicate paths without changing first-reference order', async () => {
    const state = structuredClone(DEPS_STATE)
    state.blocks.target.subBlocks.code.value =
      '<missing.value> <fetchrows.result> <fetch.result> <fetchrows.result.id> <fetchrows.result.id> {{TOKEN}} {{TOKEN}}'
    const result = await runEngine(
      'workflows deps',
      ['wf-1', 'target'],
      runtimeWith({ [STATE_PATH]: { data: state } }),
      {}
    )
    const report = JSON.parse(result.stdout)
    expect(report.references).toEqual([
      { token: 'missing.value', kind: 'unknown' },
      {
        token: 'fetchrows.result',
        kind: 'block',
        blockId: 'fetch',
        blockName: 'Fetch rows',
        paths: ['result', 'result.id'],
      },
    ])
    expect(report.env).toEqual(['TOKEN'])
    expect(report.mock['Fetch rows']).toEqual({ result: { id: null } })
  })

  it('builds indexed mocks that round-trip through the actual reference navigator', async () => {
    const state = structuredClone(DEPS_STATE)
    state.blocks.target.subBlocks.code.value =
      'return [<fetchrows.result.items[0].id>, <fetchrows.result.items[2].name>, <fetchrows.result.matrix[1][2]>, <fetchrows.result.__proto__.safe>]'
    const result = await runEngine(
      'workflows deps',
      ['wf-1', 'target'],
      runtimeWith({ [STATE_PATH]: { data: state } }),
      {}
    )
    const report = JSON.parse(result.stdout)
    const output = report.mock['Fetch rows']
    expect(output.result.items).toEqual([{ id: null }, null, { name: null }])
    expect(output.result.matrix).toEqual([null, [null, null, null]])
    expect(navigatePath(output, ['result', 'items[0]', 'id'])).toBeNull()
    expect(navigatePath(output, ['result', 'items[2]', 'name'])).toBeNull()
    expect(navigatePath(output, ['result', 'matrix[1][2]'])).toBeNull()
    expect(Object.hasOwn(output.result, '__proto__')).toBe(true)
    expect(Object.hasOwn(Object.prototype, 'safe')).toBe(false)
  })

  it('reports array examples too large to materialize instead of returning a misleading complete mock', async () => {
    const state = structuredClone(DEPS_STATE)
    state.blocks.target.subBlocks.code.value = 'return <fetchrows.result.items[1000000000].id>'
    const result = await runEngine(
      'workflows deps',
      ['wf-1', 'target'],
      runtimeWith({ [STATE_PATH]: { data: state } }),
      {}
    )
    const report = JSON.parse(result.stdout)
    expect(report.mock['Fetch rows']).toEqual({ result: { items: [] } })
    expect(report.mockOmittedArrays).toEqual([{ blockName: 'Fetch rows', path: 'result.items' }])
    expect(report.mockArrayNote).toContain('not a complete mock')
  })

  it('lists graph predecessors beside token references and mocks both', async () => {
    const result = await runEngine(
      'workflows deps',
      ['wf-1', 'target'],
      runtimeWith({ [STATE_PATH]: { data: DEPS_STATE } }),
      {}
    )
    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.references.map((d: { blockId?: string }) => d.blockId)).toEqual([
      'fetch',
      'enrich',
    ])
    // The trigger and the block itself are skipped; the unreferenced gate is not.
    expect(report.predecessors).toEqual([
      { blockId: 'fetch', blockName: 'Fetch rows', sourceHandle: 'source' },
      { blockId: 'gate', blockName: 'Gate', sourceHandle: 'condition-true' },
      { blockId: 'enrich', blockName: 'Enrich', sourceHandle: 'source' },
    ])
    // The mock is the variableInputs skeleton itself: the child-workflow return is
    // nested at result.data.<field>, and the unread predecessor is an empty entry.
    expect(report.mock).toEqual({
      'Fetch rows': { result: null },
      Enrich: { result: { data: { total: null } } },
      Gate: {},
    })
    expect(report.mockNote).toBe(
      'variableInputs: fill placeholders with representative upstream outputs'
    )
    expect(report.mockEmptyNote).toContain('Gate')
    expect(report.mockEmptyNote).not.toContain('Enrich')
    expect(report.childReturns).toEqual([
      {
        blockId: 'enrich',
        blockName: 'Enrich',
        note: expect.stringContaining('result.data.<field>'),
      },
    ])
  })

  it('merges sibling and whole-object paths of one block into a single nested skeleton', async () => {
    const state = {
      ...DEPS_STATE,
      blocks: {
        ...DEPS_STATE.blocks,
        target: {
          type: 'function',
          name: 'Summarize',
          subBlocks: {
            code: {
              value:
                'return [<fetchrows.result>, <fetchrows.result.tier>, <fetchrows.result.score.raw>]',
            },
          },
        },
      },
      edges: [{ id: 'e2', source: 'fetch', target: 'target', sourceHandle: 'source' }],
    }
    const result = await runEngine(
      'workflows deps',
      ['wf-1', 'target'],
      runtimeWith({ [STATE_PATH]: { data: state } }),
      {}
    )
    const report = JSON.parse(result.stdout)
    expect(report.mock).toEqual({ 'Fetch rows': { result: { tier: null, score: { raw: null } } } })
    expect(report.mockEmptyNote).toBeUndefined()
  })
})
