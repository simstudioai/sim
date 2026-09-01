/**
 * @vitest-environment node
 *
 * What a configured notification tool actually receives, per Human block version.
 *
 * v1 handed the tool its stored sub-block values verbatim. v2 runs the same pipeline
 * every other surface uses for a block tool — canonical basic/advanced resolution, the
 * stringified-value decode, and the block's own `tools.config.params` mapping. That
 * difference is the entire reason v2 exists as a separate block.
 */
import { describe, expect, it, vi } from 'vitest'

const notifierBlock = {
  name: 'Notifier',
  description: '',
  category: 'tools',
  subBlocks: [
    { id: 'channel', type: 'channel-selector', canonicalParamId: 'channel', mode: 'basic' },
    { id: 'manualChannel', type: 'short-input', canonicalParamId: 'channel', mode: 'advanced' },
    { id: 'silent', type: 'switch' },
  ],
  tools: {
    access: ['notifier_send'],
    config: { params: (p: any) => ({ resolvedChannel: p.channel, quiet: p.silent === true }) },
  },
  inputs: {},
  outputs: {},
}

vi.mock('@/blocks/registry', () => ({
  getBlock: (type: string) => (type === 'notifier' ? notifierBlock : undefined),
}))

vi.mock('@/tools/utils', () => ({
  getTool: () => ({
    id: 'notifier_send',
    params: { channel: { type: 'string' }, silent: { type: 'boolean' } },
  }),
}))

const executed: Array<Record<string, unknown>> = []
vi.mock('@/tools', () => ({
  executeTool: async (_toolId: string, params: Record<string, unknown>) => {
    executed.push(params)
    return { success: true, output: {} }
  },
}))

import { PAUSE_RESUME } from '@/executor/constants'
import { HumanInTheLoopBlockHandler } from '@/executor/handlers/human-in-the-loop/human-in-the-loop-handler'

/** Runs one notification whose channel was configured in ADVANCED mode. */
async function runNotification(blockTypeId: string): Promise<Record<string, unknown>> {
  executed.length = 0

  const block = {
    id: 'b1',
    metadata: { id: blockTypeId },
    position: { x: 0, y: 0 },
    config: { tool: '', params: {} },
    inputs: {},
    outputs: {},
    enabled: true,
    canonicalModes: { '0:channel': 'advanced' },
  } as never

  await new HumanInTheLoopBlockHandler().execute(
    { workflowId: 'w', executionId: 'e', blockStates: new Map() } as never,
    block,
    {
      operation: PAUSE_RESUME.OPERATION.HUMAN,
      notification: [
        {
          type: 'notifier',
          toolId: 'notifier_send',
          title: 'Notify',
          params: { channel: '', manualChannel: 'C123', silent: 'false' },
        },
      ],
    }
  )

  const params = { ...executed[0] }
  for (const key of ['_pauseContext', '_context', 'blockData', 'blockNameMapping']) {
    delete params[key]
  }
  return params
}

describe('Human block notification params', () => {
  it('v2 resolves the canonical pair, decodes the switch, and runs the block params fn', async () => {
    expect(await runNotification('human_in_the_loop_v2')).toEqual({
      // Advanced mode collapsed onto the id the tool declares.
      channel: 'C123',
      // The stringified switch became a real boolean.
      silent: false,
      // The block's own mapping ran.
      resolvedChannel: 'C123',
      quiet: false,
    })
  })

  it('v1 keeps handing the tool its raw stored values', async () => {
    // Deliberately unchanged: altering what an already-configured v1 notification sends
    // is exactly the break v2 exists to avoid.
    expect(await runNotification('human_in_the_loop')).toEqual({
      channel: '',
      manualChannel: 'C123',
      silent: 'false',
    })
  })

  it('handles both versions', () => {
    const handler = new HumanInTheLoopBlockHandler()
    for (const id of ['human_in_the_loop', 'human_in_the_loop_v2']) {
      expect(handler.canHandle({ metadata: { id } } as never)).toBe(true)
    }
    expect(handler.canHandle({ metadata: { id: 'agent' } } as never)).toBe(false)
  })
})
