import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { withToolServiceMeter } from './service-meter'
import { recordServiceCost, recordServiceMeteringFailure } from './service-observer'

const store = vi.hoisted(() => ({
  beginServiceMeter: vi.fn(),
  finishServiceUsage: vi.fn(),
  saveServiceUsage: vi.fn(),
  replayServiceUsage: vi.fn(async () => {}),
}))
vi.mock('@/lib/mothership/billing/service-store', () => store)
vi.mock('@/lib/mothership/billing/service-delivery', () => ({
  replayServiceUsage: store.replayServiceUsage,
}))
afterAll(resetEnvFlagsMock)
beforeEach(() => {
  vi.resetAllMocks()
  store.replayServiceUsage.mockResolvedValue(undefined)
  setEnvFlags({ isHosted: true })
})
const context = {
  userId: 'user',
  workflowId: '',
  copilotToolExecution: true,
  toolCallId: 'call',
  messageId: '11111111-1111-4111-8111-111111111111',
  mothershipBaseURL: 'http://127.0.0.1:8080',
}

describe('trusted service metering', () => {
  it('does not read arbitrary MCP or user code output as billing authority', async () => {
    const output = await withToolServiceMeter(context, async () => ({
      cost: { raw: 100 },
      _serviceCost: { service: 'exa', cost: 100 },
    }))
    expect(output.cost.raw).toBe(100)
    expect(store.saveServiceUsage).not.toHaveBeenCalled()
    expect(store.replayServiceUsage).not.toHaveBeenCalled()
    expect(store.beginServiceMeter).toHaveBeenCalledOnce()
    expect(store.finishServiceUsage).toHaveBeenCalledWith(expect.any(String))
  })
  it('persists known spend before returning even after Stop', async () => {
    const controller = new AbortController()
    await withToolServiceMeter({ ...context, abortSignal: controller.signal }, async () => {
      controller.abort()
      await recordServiceCost('falai_video', 0.3)
      expect(store.replayServiceUsage).toHaveBeenCalledOnce()
      expect(store.saveServiceUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          streamId: context.messageId,
          toolCallId: context.toolCallId,
          service: 'falai_video',
          costUsd: 0.3,
        }),
        context.mothershipBaseURL
      )
    })
  })
  it('refuses provider execution when the durable intent cannot be saved', async () => {
    store.beginServiceMeter.mockRejectedValueOnce(new Error('database unavailable'))
    const execute = vi.fn()
    await expect(withToolServiceMeter(context, execute)).rejects.toThrow('database unavailable')
    expect(execute).not.toHaveBeenCalled()
  })
  it('leaves pricing failure visible for reconciliation instead of marking it delivered', async () => {
    await withToolServiceMeter(context, async () => {
      await recordServiceMeteringFailure('provider pricing unavailable')
    })
    expect(store.finishServiceUsage).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      'provider pricing unavailable'
    )
  })
  it('retains an unresolved intent when a provider execution fails or is interrupted', async () => {
    await expect(
      withToolServiceMeter(context, async () => {
        throw new Error('provider connection interrupted')
      })
    ).rejects.toThrow('provider connection interrupted')
    expect(store.finishServiceUsage).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      'provider connection interrupted'
    )
  })
  it('isolates simultaneous tools and their billing identities', async () => {
    await Promise.all(
      ['a', 'b'].map((toolCallId) =>
        withToolServiceMeter({ ...context, toolCallId }, async () => {
          await Promise.resolve()
          await recordServiceCost(toolCallId, 0.1)
        })
      )
    )
    expect(
      store.saveServiceUsage.mock.calls
        .map(([receipt]) => [receipt.toolCallId, receipt.service])
        .sort()
    ).toEqual([
      ['a', 'a'],
      ['b', 'b'],
    ])
  })
})
