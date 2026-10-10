import type { SessionPrincipal } from '@sim/auth/principal'
import { createSerializedBlock, createSerializedWorkflow } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockChannel,
  type MockChannel,
  type MockMatcher,
} from '@/lib/workflow-tests/mock-channel'
import { BlockType } from '@/executor/constants'
import { DAGExecutor } from '@/executor/execution/executor'
import type { ExecutionResult } from '@/executor/types'
import { stripCloneSuffixes } from '@/executor/utils/subflow-node-id-codec'
import type { SerializedWorkflow } from '@/serializer/types'

const { executed, inputsSeen } = vi.hoisted(() => ({
  executed: [] as string[],
  inputsSeen: [] as Array<{ blockId: string; inputs: Record<string, unknown> }>,
}))

vi.mock('@/executor/handlers/registry', () => ({
  createBlockHandlers: () => [
    {
      canHandle: () => true,
      execute: async (_ctx: unknown, block: { id: string }, inputs: Record<string, unknown>) => {
        executed.push(block.id)
        inputsSeen.push({ blockId: block.id, inputs })
        return { ok: true, from: block.id }
      },
    },
  ],
}))

const PRINCIPAL: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

const BLOCK_TYPES: Record<string, string> = {
  start: BlockType.STARTER,
  loop: BlockType.LOOP,
  fanOut: BlockType.PARALLEL,
}

function workflow(
  connections: SerializedWorkflow['connections'],
  params: Record<string, Record<string, unknown>> = {},
  loops: SerializedWorkflow['loops'] = {},
  parallels: SerializedWorkflow['parallels'] = {}
): SerializedWorkflow {
  const ids = new Set(connections.flatMap((c) => [c.source, c.target]))
  const blocks = [...ids].map((id) =>
    createSerializedBlock({
      id,
      name: id,
      type: BLOCK_TYPES[id] ?? BlockType.API,
      params: params[id] ?? {},
    })
  )
  return { ...createSerializedWorkflow(blocks, connections), loops, parallels }
}

/** A test's matcher that mocks exactly these block ids and nothing else. */
function mockingBlocks(blockIds: string[]): MockMatcher {
  const mocked = new Set(blockIds)
  return {
    enterWorkflow: async () => {},
    mocksBlock: (blockId) => mocked.has(blockId),
    mocksTool: () => false,
    spiesBlock: () => false,
    recordSpy: () => {},
  }
}

function run(
  wf: SerializedWorkflow,
  channel: MockChannel,
  abortSignal?: AbortSignal
): Promise<ExecutionResult> {
  return new DAGExecutor({
    workflow: wf,
    contextExtensions: {
      workspaceId: 'ws',
      executionId: 'exec-1',
      principal: PRINCIPAL,
      executorDelegationOrigin: {
        workflowId: 'wf',
        currentWorkflow: { workflowId: 'wf', mode: 'draft' },
      },
      testHooks: channel.hooks,
      ...(abortSignal ? { abortSignal } : {}),
    },
  }).execute('wf')
}

const inputsOf = (blockId: string) =>
  inputsSeen.filter((seen) => stripCloneSuffixes(seen.blockId) === blockId).map((s) => s.inputs)

describe('executor test hooks', () => {
  beforeEach(() => {
    executed.length = 0
    inputsSeen.length = 0
  })

  const linear = workflow(
    [
      { source: 'start', target: 'prep' },
      { source: 'prep', target: 'lookup' },
      { source: 'lookup', target: 'notify' },
    ],
    {
      lookup: { query: '<prep.from>' },
      notify: { plan: '<lookup.plan>' },
    }
  )

  it('parks a mocked block with its resolved inputs and feeds the reply downstream', async () => {
    const channel = createMockChannel(mockingBlocks(['lookup']))
    const done = run(linear, channel)

    const parked = await channel.nextCall()
    expect(parked.call.blockId).toBe('lookup')
    expect(parked.call.blockName).toBe('lookup')
    expect(parked.call.input).toEqual({ query: 'prep' })

    channel.reply(parked.callId, { output: { plan: 'pro' } })
    const result = await done

    expect(result.success).toBe(true)
    expect(executed).not.toContain('lookup')
    expect(inputsOf('notify')).toEqual([{ plan: 'pro' }])
  })

  it('fails the block, and the run, with the error a mock rejects with', async () => {
    const channel = createMockChannel(mockingBlocks(['lookup']))
    const done = run(linear, channel)

    const parked = await channel.nextCall()
    channel.reply(parked.callId, { error: 'rate limited (429)' })

    await expect(done).rejects.toThrow('rate limited (429)')
    expect(executed).not.toContain('notify')
  })

  it('stops a run that is cancelled while a mock is parked, and refuses a late reply', async () => {
    const channel = createMockChannel(mockingBlocks(['lookup']))
    const abort = new AbortController()
    const done = run(linear, channel, abort.signal)

    const parked = await channel.nextCall()
    abort.abort()
    const result = await done

    expect(result.success).toBe(false)
    expect(executed).not.toContain('notify')
    expect(() => channel.reply(parked.callId, { output: { plan: 'pro' } })).toThrow()
  })

  it('routes each parallel branch its own reply, whatever order the replies arrive in', async () => {
    const parallel = workflow(
      [
        { source: 'start', target: 'fanOut' },
        { source: 'fanOut', target: 'lookup', sourceHandle: 'parallel-start-source' },
        { source: 'lookup', target: 'notify' },
      ],
      { notify: { plan: '<lookup.plan>' } },
      {},
      {
        fanOut: {
          id: 'fanOut',
          nodes: ['lookup', 'notify'],
          count: 3,
          parallelType: 'count',
        },
      }
    )
    const channel = createMockChannel(mockingBlocks(['lookup']))
    const done = run(parallel, channel)

    const parked = [await channel.nextCall(), await channel.nextCall(), await channel.nextCall()]
    for (const [i, call] of [...parked].reverse().entries()) {
      channel.reply(call.callId, { output: { plan: `plan-${call.call.branchIndex}-${i}` } })
    }
    const result = await done

    expect(result.success).toBe(true)
    expect(parked.map((p) => p.call.branchIndex).sort()).toEqual([0, 1, 2])
    const plans = inputsOf('notify').map((inputs) => String(inputs.plan))
    expect(plans).toHaveLength(3)
    expect(plans.map((plan) => plan.split('-')[1]).sort()).toEqual(['0', '1', '2'])
  })

  it('delivers one call per loop iteration, in order', async () => {
    const looped = workflow(
      [
        { source: 'start', target: 'loop' },
        { source: 'loop', target: 'lookup', sourceHandle: 'loop-start-source' },
        { source: 'lookup', target: 'notify' },
      ],
      { notify: { plan: '<lookup.plan>' } },
      { loop: { id: 'loop', nodes: ['lookup', 'notify'], iterations: 2, loopType: 'for' } }
    )
    const channel = createMockChannel(mockingBlocks(['lookup']))
    const done = run(looped, channel)

    for (const plan of ['first', 'second']) {
      const parked = await channel.nextCall()
      channel.reply(parked.callId, { output: { plan } })
    }
    const result = await done

    expect(result.success).toBe(true)
    expect(inputsOf('notify')).toEqual([{ plan: 'first' }, { plan: 'second' }])
  })

  it('refuses a reply to a call that is unknown or already answered', async () => {
    const channel = createMockChannel(mockingBlocks(['lookup']))
    const done = run(linear, channel)

    const parked = await channel.nextCall()
    expect(() => channel.reply('nope', { output: {} })).toThrow()
    channel.reply(parked.callId, { output: { plan: 'pro' } })
    expect(() => channel.reply(parked.callId, { output: { plan: 'pro' } })).toThrow()
    await done
  })

  it('rejects every parked call when the channel closes, so the run cannot hang', async () => {
    const channel = createMockChannel(mockingBlocks(['lookup']))
    const done = run(linear, channel)

    await channel.nextCall()
    channel.close(new Error('test sandbox exited'))

    await expect(done).rejects.toThrow('test sandbox exited')
    await expect(channel.nextCall()).rejects.toThrow('test sandbox exited')
  })
})
