import type { SessionPrincipal } from '@sim/auth/principal'
import { createSerializedBlock, createSerializedWorkflow } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedBlockOutput } from '@/executor/types'

const { executed, gateChoice, inputsByBlock, outputsByBlock } = vi.hoisted(() => ({
  executed: [] as string[],
  gateChoice: { value: 'if' as 'if' | 'else' },
  inputsByBlock: new Map<string, Record<string, unknown>>(),
  outputsByBlock: new Map<string, NormalizedBlockOutput>(),
}))

vi.mock('@/executor/handlers/registry', () => ({
  createBlockHandlers: () => [
    {
      canHandle: () => true,
      execute: async (
        _ctx: unknown,
        block: { id: string; metadata?: { id?: string; name?: string } },
        inputs: Record<string, unknown>
      ) => {
        executed.push(block.id)
        inputsByBlock.set(block.id, inputs)
        if (block.metadata?.id === 'condition') {
          return { selectedOption: `${block.metadata.name}-${gateChoice.value}` }
        }
        return outputsByBlock.get(block.id) ?? { ok: true }
      },
    },
  ],
}))

import { BlockType } from '@/executor/constants'
import { DAGExecutor } from '@/executor/execution/executor'
import { stripCloneSuffixes } from '@/executor/utils/subflow-utils'
import type { SerializedWorkflow } from '@/serializer/types'

const PRINCIPAL: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

/** Block ids double as their type for the special blocks; every other block is a function. */
const BLOCK_TYPES: Record<string, string> = {
  start: BlockType.STARTER,
  gate: BlockType.CONDITION,
  loop: BlockType.LOOP,
  fanOut: BlockType.PARALLEL,
}

function workflow(
  connections: SerializedWorkflow['connections'],
  loops: SerializedWorkflow['loops'] = {},
  parallels: SerializedWorkflow['parallels'] = {}
): SerializedWorkflow {
  const ids = new Set(connections.flatMap((c) => [c.source, c.target]))
  const blocks = [...ids].map((id) =>
    createSerializedBlock({ id, name: id, type: BLOCK_TYPES[id] ?? BlockType.FUNCTION })
  )
  return { ...createSerializedWorkflow(blocks, connections), loops, parallels }
}

function createExecutor(wf: SerializedWorkflow, executionId: string): DAGExecutor {
  return new DAGExecutor({
    workflow: wf,
    contextExtensions: { workspaceId: 'ws', executionId, principal: PRINCIPAL },
  })
}

/** A full run with one gate decision, then a run-from-block seeded from that run's snapshot. */
async function rerunFromBlock(
  wf: SerializedWorkflow,
  startBlockId: string,
  first: 'if' | 'else',
  second: 'if' | 'else'
): Promise<string[]> {
  gateChoice.value = first
  const run1 = await createExecutor(wf, 'exec-1').execute('wf')
  expect(run1.success).toBe(true)
  expect(run1.executionState).toBeDefined()

  executed.length = 0
  gateChoice.value = second
  const run2 = await createExecutor(wf, 'exec-2').executeFromBlock(
    'wf',
    startBlockId,
    run1.executionState!
  )
  expect(run2.success).toBe(true)
  return [...executed]
}

const exclusive = workflow([
  { source: 'start', target: 'prep' },
  { source: 'prep', target: 'gate' },
  { source: 'gate', target: 'readDoc', sourceHandle: 'condition-gate-if' },
  { source: 'gate', target: 'noDoc', sourceHandle: 'condition-gate-else' },
])

const diamond = workflow([
  { source: 'start', target: 'prep' },
  { source: 'prep', target: 'gate' },
  { source: 'gate', target: 'readDoc', sourceHandle: 'condition-gate-if' },
  { source: 'gate', target: 'docPlan', sourceHandle: 'condition-gate-else' },
  { source: 'readDoc', target: 'docPlan' },
])

const siblings = workflow([
  { source: 'start', target: 'a' },
  { source: 'start', target: 'b' },
  { source: 'a', target: 'join' },
  { source: 'b', target: 'join' },
])

const looped = workflow(
  [
    { source: 'start', target: 'prep' },
    { source: 'prep', target: 'loop' },
    { source: 'loop', target: 'gate', sourceHandle: 'loop-start-source' },
    { source: 'gate', target: 'readDoc', sourceHandle: 'condition-gate-if' },
    { source: 'gate', target: 'noDoc', sourceHandle: 'condition-gate-else' },
  ],
  { loop: { id: 'loop', nodes: ['gate', 'readDoc', 'noDoc'], iterations: 1, loopType: 'for' } }
)

describe('DAGExecutor run-from-block edge state', () => {
  beforeEach(() => {
    executed.length = 0
    inputsByBlock.clear()
    outputsByBlock.clear()
  })

  it('restores persisted ancestor outputs across a disabled intermediate without rerunning it', async () => {
    const graph = workflow([
      { source: 'start', target: 'parseAction' },
      { source: 'parseAction', target: 'acknowledge' },
      { source: 'acknowledge', target: 'lookup' },
      { source: 'lookup', target: 'publish' },
      { source: 'start', target: 'unrelated' },
    ])
    graph.blocks.find((block) => block.id === 'acknowledge')!.enabled = false
    const lookup = graph.blocks.find((block) => block.id === 'lookup')!
    lookup.metadata!.id = 'api'
    lookup.config.params = { candidateId: '<parseaction.result.candidateId>' }
    outputsByBlock.set('parseAction', { result: { candidateId: 'candidate-test' } })
    outputsByBlock.set('unrelated', { result: 'not an ancestor' })

    const first = await createExecutor(graph, 'source-run').execute('wf')
    expect(first.success).toBe(true)
    expect(executed).not.toContain('acknowledge')
    expect(executed).not.toContain('lookup')
    expect(first.executionState?.blockStates.parseAction.output).toEqual({
      result: { candidateId: 'candidate-test' },
    })

    executed.length = 0
    const replay = await createExecutor(graph, 'replay-run').executeFromBlock(
      'wf',
      'lookup',
      first.executionState!
    )
    expect(replay.success).toBe(true)
    expect(inputsByBlock.get('lookup')?.candidateId).toBe('candidate-test')
    expect(executed).toEqual(['lookup', 'publish'])
    expect(replay.executionState?.blockStates.unrelated).toBeUndefined()
    expect(replay.executionState?.executedBlocks).not.toContain('acknowledge')
  })

  it('restores ancestors across a disabled bridge without restoring dirty outputs or old branch choices', async () => {
    const graph = workflow([
      { source: 'start', target: 'prep' },
      { source: 'prep', target: 'acknowledge' },
      { source: 'acknowledge', target: 'lookup' },
      { source: 'lookup', target: 'gate' },
      { source: 'gate', target: 'oldBranch', sourceHandle: 'condition-gate-if' },
      { source: 'gate', target: 'newBranch', sourceHandle: 'condition-gate-else' },
      { source: 'oldBranch', target: 'join' },
      { source: 'newBranch', target: 'join' },
    ])
    const join = graph.blocks.find((block) => block.id === 'join')!
    join.metadata!.id = 'api'
    join.config.params = { version: '<lookup.result.version>' }
    outputsByBlock.set('lookup', { result: { version: 'old' } })
    gateChoice.value = 'if'
    const first = await createExecutor(graph, 'source-run').execute('wf')
    expect(first.success).toBe(true)

    graph.blocks.find((block) => block.id === 'acknowledge')!.enabled = false
    outputsByBlock.set('lookup', { result: { version: 'new' } })
    gateChoice.value = 'else'
    executed.length = 0
    const replay = await createExecutor(graph, 'replay-run').executeFromBlock(
      'wf',
      'lookup',
      first.executionState!
    )

    expect(replay.success).toBe(true)
    expect(executed).toEqual(['lookup', 'gate', 'newBranch', 'join'])
    expect(inputsByBlock.get('join')?.version).toBe('new')
    expect(replay.executionState?.blockStates.prep).toBeDefined()
    expect(replay.executionState?.blockStates.oldBranch).toBeUndefined()
    expect(replay.executionState?.executedBlocks).not.toContain('oldBranch')
  })

  it.each([
    {
      title: 'does not run an unselected branch the source execution had activated',
      wf: exclusive,
      start: 'prep',
      first: 'if',
      second: 'else',
      expected: ['prep', 'gate', 'noDoc'],
    },
    {
      title: 'runs the branch the source execution had deactivated when it is selected',
      wf: exclusive,
      start: 'prep',
      first: 'else',
      second: 'if',
      expected: ['prep', 'gate', 'readDoc'],
    },
    {
      title: 'waits for the live input of a join the source execution had released early',
      wf: diamond,
      start: 'prep',
      first: 'else',
      second: 'if',
      expected: ['prep', 'gate', 'readDoc', 'docPlan'],
    },
    {
      title: 'still runs the join directly when its other input is deselected',
      wf: diamond,
      start: 'prep',
      first: 'if',
      second: 'else',
      expected: ['prep', 'gate', 'docPlan'],
    },
    {
      title: 'does not wait on a cached sibling input outside the re-run region',
      wf: siblings,
      start: 'a',
      first: 'if',
      second: 'if',
      expected: ['a', 'join'],
    },
    {
      title: 'does not run a stale branch inside a loop',
      wf: looped,
      start: 'prep',
      first: 'if',
      second: 'else',
      expected: ['prep', 'gate', 'noDoc'],
    },
  ] as const)('$title', async ({ wf, start, first, second, expected }) => {
    expect(await rerunFromBlock(wf, start, first, second)).toEqual(expected)
  })

  it('runs a join once after every re-run input completes', async () => {
    const fanIn = workflow([
      { source: 'start', target: 'prep' },
      { source: 'prep', target: 'a' },
      { source: 'prep', target: 'b' },
      { source: 'a', target: 'join' },
      { source: 'b', target: 'join' },
    ])
    const order = await rerunFromBlock(fanIn, 'prep', 'if', 'if')
    expect(order.filter((id) => id === 'join')).toHaveLength(1)
    expect(order.indexOf('join')).toBeGreaterThan(Math.max(order.indexOf('a'), order.indexOf('b')))
  })

  it.each([
    { failedAt: null, expected: ['start', 'download', 'parseDoc', 'prepare'], text: 'resume text' },
    { failedAt: 'download', expected: ['start', 'download', 'prepare'], text: '' },
    { failedAt: 'parseDoc', expected: ['start', 'download', 'parseDoc', 'prepare'], text: '' },
  ])(
    'joins success/error paths after their active prerequisites ($failedAt)',
    async ({ failedAt, expected, text }) => {
      const graph = workflow([
        { source: 'start', target: 'download' },
        { source: 'download', target: 'parseDoc', sourceHandle: 'source' },
        { source: 'download', target: 'prepare', sourceHandle: 'error' },
        { source: 'parseDoc', target: 'prepare', sourceHandle: 'source' },
        { source: 'parseDoc', target: 'prepare', sourceHandle: 'error' },
      ])
      const prepare = graph.blocks.find((block) => block.id === 'prepare')!
      prepare.metadata!.id = 'api'
      prepare.config.params = { text: '<parsedoc.result.text>' }
      outputsByBlock.set('parseDoc', { result: { text: 'resume text' } })
      if (failedAt) outputsByBlock.set(failedAt, { error: 'provider failure' })

      const result = await createExecutor(graph, 'fan-in-run').execute('wf')

      expect(result.success).toBe(true)
      expect(executed).toEqual(expected)
      expect(inputsByBlock.get('prepare')?.text).toBe(text)
    }
  )

  it('does not run a stale branch in any parallel branch copy', async () => {
    const parallel = workflow(
      [
        { source: 'start', target: 'prep' },
        { source: 'prep', target: 'fanOut' },
        { source: 'fanOut', target: 'gate', sourceHandle: 'parallel-start-source' },
        { source: 'gate', target: 'readDoc', sourceHandle: 'condition-gate-if' },
        { source: 'gate', target: 'noDoc', sourceHandle: 'condition-gate-else' },
      ],
      {},
      {
        fanOut: {
          id: 'fanOut',
          nodes: ['gate', 'readDoc', 'noDoc'],
          count: 3,
          parallelType: 'count',
        },
      }
    )
    const ids = (await rerunFromBlock(parallel, 'prep', 'if', 'else')).map(stripCloneSuffixes)
    expect(ids).not.toContain('readDoc')
    expect(ids.filter((id) => id === 'noDoc')).toHaveLength(3)
  })
})
