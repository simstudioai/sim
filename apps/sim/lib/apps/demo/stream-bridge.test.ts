import { describe, expect, it, vi } from 'vitest'
import { FullstackWorkerStreamBridge } from '@/lib/apps/demo/stream-bridge'

describe('FullstackWorkerStreamBridge', () => {
  it('drops all nested events after the bridge closes', async () => {
    const publish = vi.fn(async () => undefined)
    const bridge = new FullstackWorkerStreamBridge(publish)

    await bridge.forward({
      type: 'tool',
      payload: {
        phase: 'call',
        toolCallId: 'tool-1',
        toolName: 'create_workflow',
        executor: 'sim',
        mode: 'sync',
      },
    })
    await bridge.close()
    const countAfterClose = publish.mock.calls.length

    await bridge.forward({
      type: 'resource',
      payload: {
        op: 'upsert',
        resource: { type: 'workflow', id: 'wf-late', title: 'Late workflow' },
      },
    })

    expect(publish).toHaveBeenCalledTimes(countAfterClose)
    expect(publish.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        type: 'span',
        payload: expect.objectContaining({ event: 'end' }),
      })
    )
  })
})
