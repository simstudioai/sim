/** @vitest-environment jsdom */
import { Blob as NodeBlob } from 'node:buffer'
import { ComputerUseError } from '@sim/desktop-bridge'
import { type ComputerUseResult, ComputerUseResultSchema } from '@sim/desktop-bridge/computer-use'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copilotConfirmBodySchema } from '@/lib/api/contracts/copilot'
import { executeComputerToolOnClient } from '@/lib/mothership/tools/client/computer-tool-execution'
import { clearUserData } from '@/stores'
import '@/stores/reset-all-stores'

const native = vi.hoisted(() => ({ execute: vi.fn(), cancel: vi.fn() }))
vi.mock('@/lib/computer-use/transport', () => ({
  executeComputerUseTool: native.execute,
  cancelComputerUseTool: native.cancel,
}))

let sequence = 0
const nextId = () => `computer-unload-${++sequence}`

describe('native computer completion during page unload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('Blob', NodeBlob)
    native.execute.mockReset()
    native.cancel.mockResolvedValue(undefined)
  })
  afterEach(() => vi.useRealTimers())

  it('preserves partial action progress in unload-safe fallback before HTTP acknowledgment', async () => {
    const started = createDeferred<void>()
    const acknowledged = createDeferred<Response>()
    const fallbackBodies: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_url, init) => {
        if (init?.keepalive) {
          fallbackBodies.push(String(init.body))
          return new Response(null, { status: 200 })
        }
        started.resolve()
        return acknowledged.promise
      })
    )
    const beacons: NodeBlob[] = []
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (_url: string, body: NodeBlob) => {
        beacons.push(body)
        return false
      },
    })
    const result: ComputerUseResult = {
      kind: 'action',
      action: 'input_sequence',
      bundleId: 'com.example.Fixture',
      dispatched: true,
      verified: false,
      sequence: { completedSteps: 1, totalSteps: 2, error: 'Focus changed' },
      observation: {
        kind: 'state',
        bundleId: 'com.example.Fixture',
        snapshotId: 'after',
        windowId: 'window',
        windows: [],
        nodes: [],
        truncated: false,
        screenshot: { base64: 'A'.repeat(100_000), mimeType: 'image/png', width: 1, height: 1 },
      },
    }
    native.execute.mockResolvedValueOnce(ComputerUseResultSchema.parse(result))
    const id = nextId()
    const execution = executeComputerToolOnClient(
      id,
      {
        action: 'input_sequence',
        bundleId: 'com.example.Fixture',
        snapshotId: 'before',
        elementId: 'editor',
        steps: [
          { action: 'press_key', key: 'Tab' },
          { action: 'type_text', text: 'text' },
        ],
        observeAfter: {},
      },
      new Date().toISOString()
    )
    await started.promise
    try {
      window.dispatchEvent(new Event('pagehide'))
      await flushMicrotasks()
      expect(beacons).toHaveLength(1)
      expect(beacons[0].size).toBeLessThanOrEqual(48 * 1024)
      const payload = copilotConfirmBodySchema.parse(JSON.parse(await beacons[0].text()))
      expect(payload).toMatchObject({
        toolCallId: id,
        status: 'success',
        data: {
          dispatched: true,
          verified: false,
          sequence: { completedSteps: 1, totalSteps: 2, error: 'Focus changed' },
        },
      })
      expect(payload.data).not.toHaveProperty('outcomeUnknown', true)
      expect(payload.data).not.toHaveProperty('observations')
      expect(fallbackBodies).toEqual([await beacons[0].text()])
      expect(native.cancel).not.toHaveBeenCalled()
    } finally {
      acknowledged.resolve(new Response(null, { status: 200 }))
      await execution
    }
    const count = beacons.length
    window.dispatchEvent(new Event('pagehide'))
    expect(beacons).toHaveLength(count)
    expect(native.execute).toHaveBeenCalledOnce()
  })

  it('bounds escaped non-image result data for unload delivery', async () => {
    const started = createDeferred<void>()
    const acknowledged = createDeferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => {
        started.resolve()
        return acknowledged.promise
      })
    )
    const bodies: NodeBlob[] = []
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (_url: string, body: NodeBlob) => {
        bodies.push(body)
        return true
      },
    })
    native.execute.mockResolvedValueOnce(
      ComputerUseResultSchema.parse({
        kind: 'apps',
        apps: Array.from({ length: 1000 }, (_, index) => ({
          bundleId: `com.example.App${index}`,
          name: '\0'.repeat(1024),
          isActive: false,
        })),
      })
    )
    const id = nextId()
    const execution = executeComputerToolOnClient(
      id,
      { action: 'list_apps' },
      new Date().toISOString()
    )
    await started.promise
    try {
      window.dispatchEvent(new Event('pagehide'))
      expect(bodies).toHaveLength(1)
      expect(bodies[0].size).toBeLessThanOrEqual(48 * 1024)
      expect(copilotConfirmBodySchema.parse(JSON.parse(await bodies[0].text()))).toMatchObject({
        toolCallId: id,
        status: 'success',
        data: { resultOmittedDuringPageExit: true },
      })
    } finally {
      acknowledged.resolve(new Response(null, { status: 200 }))
      await execution
    }
  })

  it.each([false, true])(
    'retains native input uncertainty through delivery failure and replay (unknown=%s)',
    async (outcomeUnknown) => {
      native.execute.mockRejectedValueOnce(
        new ComputerUseError({
          code: outcomeUnknown ? 'focus_changed' : 'activation_required',
          message: outcomeUnknown
            ? 'The exact editor is no longer focused; remaining input was not dispatched. Observe again.'
            : 'Activate first.',
          ...(outcomeUnknown ? {} : { dispatchState: 'not_started' as const }),
        })
      )
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(null, { status: 503 }))
      vi.stubGlobal('fetch', fetch)
      const bodies: NodeBlob[] = []
      Object.defineProperty(navigator, 'sendBeacon', {
        configurable: true,
        value: (_url: string, body: NodeBlob) => {
          bodies.push(body)
          return false
        },
      })
      const id = nextId()
      const timestamp = new Date().toISOString()
      const input = {
        action: 'type_text' as const,
        bundleId: 'com.example.Fixture',
        snapshotId: 'before',
        elementId: 'editor',
        text: 'prefix then interruption',
      }
      const execution = executeComputerToolOnClient(id, input, timestamp)
      await vi.advanceTimersByTimeAsync(15_000)
      await execution
      try {
        window.dispatchEvent(new Event('pagehide'))
        await flushMicrotasks()
        expect(bodies).toHaveLength(1)
        expect(copilotConfirmBodySchema.parse(JSON.parse(await bodies[0].text()))).toMatchObject({
          toolCallId: id,
          status: 'error',
          data: {
            code: outcomeUnknown ? 'focus_changed' : 'activation_required',
            ...(outcomeUnknown ? {} : { dispatchState: 'not_started' }),
            doNotRetry: outcomeUnknown,
            outcomeUnknown,
          },
        })
        const fallback = fetch.mock.calls.find(([, init]) => init?.keepalive)
        expect(fallback?.[1]?.body).toBe(await bodies[0].text())
        expect(native.cancel).not.toHaveBeenCalled()
      } finally {
        fetch.mockResolvedValue(new Response(null, { status: 200 }))
        const redelivery = executeComputerToolOnClient(id, input, timestamp)
        await vi.advanceTimersByTimeAsync(15_000)
        await redelivery
      }
      const count = bodies.length
      window.dispatchEvent(new Event('pagehide'))
      expect(bodies).toHaveLength(count)
      expect(
        copilotConfirmBodySchema.parse(JSON.parse(String(fetch.mock.lastCall?.[1]?.body)))
      ).toMatchObject({
        toolCallId: id,
        status: 'error',
        data: {
          ...(outcomeUnknown ? {} : { dispatchState: 'not_started' }),
          outcomeUnknown,
          doNotRetry: outcomeUnknown,
        },
      })
      expect(native.execute).toHaveBeenCalledOnce()
    }
  )

  it('redelivers a full retained queue after recovery without replaying native actions', async () => {
    const accepted = new Map<string, string>()
    let connected = false
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = String(init?.body)
      const result = copilotConfirmBodySchema.parse(JSON.parse(body))
      if (!connected) return new Response(null, { status: 503 })
      accepted.set(result.toolCallId, body)
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const ids = Array.from({ length: 8 }, nextId)
    const timestamp = new Date().toISOString()
    const input = {
      action: 'type_text',
      bundleId: 'com.example.Fixture',
      snapshotId: 'before',
      elementId: 'editor',
      text: 'send once',
    }
    for (let index = 0; index < ids.length; index++) {
      if (index % 2 === 0)
        native.execute.mockResolvedValueOnce({
          kind: 'action',
          action: 'type_text',
          bundleId: input.bundleId,
          dispatched: true,
          verified: false,
        })
      else native.execute.mockRejectedValueOnce(new Error('Native response lost after dispatch'))
    }
    const pending = ids.map((id) => executeComputerToolOnClient(id, input, timestamp))
    await vi.advanceTimersByTimeAsync(15_000)
    await Promise.all(pending)
    const initial = new Map(
      fetcher.mock.calls.map(([, init]) => {
        const body = String(init?.body)
        return [copilotConfirmBodySchema.parse(JSON.parse(body)).toolCallId, body]
      })
    )
    expect(initial.size).toBe(8)
    expect(accepted.size).toBe(0)
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(40)
    try {
      connected = true
      await vi.advanceTimersByTimeAsync(60_000)
      expect([...accepted].sort()).toEqual([...initial].sort())
      expect(native.execute).toHaveBeenCalledTimes(8)
      const settledRequests = fetcher.mock.calls.length
      await vi.advanceTimersByTimeAsync(120_000)
      expect(fetcher.mock.calls.length).toBe(settledRequests)
      native.execute.mockResolvedValueOnce({ kind: 'apps', apps: [] })
      const next = nextId()
      await executeComputerToolOnClient(next, { action: 'list_apps' }, new Date().toISOString())
      expect(copilotConfirmBodySchema.parse(JSON.parse(accepted.get(next) ?? '{}'))).toMatchObject({
        toolCallId: next,
        status: 'success',
      })
      expect(native.execute).toHaveBeenCalledTimes(9)
    } finally {
      connected = true
      const cleanup = ids
        .filter((id) => !accepted.has(id))
        .map((id) => executeComputerToolOnClient(id, input, timestamp))
      await vi.advanceTimersByTimeAsync(60_000)
      await Promise.all(cleanup)
    }
  })

  it('reports an uncertain action and cancels only while native work is still pending', async () => {
    const nativeResult = createDeferred<ComputerUseResult>()
    native.execute.mockReturnValueOnce(nativeResult.promise)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    )
    const bodies: NodeBlob[] = []
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (_url: string, body: NodeBlob) => {
        bodies.push(body)
        return true
      },
    })
    const id = nextId()
    const execution = executeComputerToolOnClient(
      id,
      { action: 'list_apps' },
      new Date().toISOString()
    )
    try {
      window.dispatchEvent(new Event('pagehide'))
      expect(bodies).toHaveLength(1)
      expect(copilotConfirmBodySchema.parse(JSON.parse(await bodies[0].text()))).toMatchObject({
        toolCallId: id,
        status: 'error',
        data: { outcomeUnknown: true, doNotRetry: true },
      })
      expect(native.cancel).toHaveBeenCalledExactlyOnceWith(id)
    } finally {
      nativeResult.resolve({ kind: 'apps', apps: [] })
      await execution
    }
  })

  it.each(['retained', 'backoff', 'request', 'native'] as const)(
    'stops old-identity delivery during %s and admits the next identity',
    async (phase) => {
      const nativeResult = createDeferred<ComputerUseResult>()
      const pendingResponse = createDeferred<Response>()
      const pendingSignals: AbortSignal[] = []
      let signedOut = false
      let connected = false
      const fetcher = vi.fn<typeof fetch>((_url, init) => {
        if (connected) return Promise.resolve(new Response(null, { status: 200 }))
        if (phase === 'request') {
          const signal = init?.signal
          if (!signal) throw new Error('Missing completion abort signal')
          pendingSignals.push(signal)
          return new Promise<Response>((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            pendingResponse.promise.then(resolve, reject)
          })
        }
        return Promise.resolve(new Response(null, { status: signedOut ? 401 : 503 }))
      })
      vi.stubGlobal('fetch', fetcher)
      const beacon = vi.fn(() => false)
      Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
      if (phase === 'native') native.execute.mockReturnValueOnce(nativeResult.promise)
      else native.execute.mockResolvedValueOnce({ kind: 'apps', apps: [] })
      const id = nextId()
      const timestamp = new Date().toISOString()
      const execution = executeComputerToolOnClient(id, { action: 'list_apps' }, timestamp)
      await flushMicrotasks()
      if (phase === 'retained') {
        await vi.advanceTimersByTimeAsync(15_000)
        await execution
        expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(5)
      }
      if (phase === 'request') {
        window.dispatchEvent(new Event('pagehide'))
        await flushMicrotasks()
        expect(pendingSignals).toHaveLength(2)
      }
      const callsBeforeSignOut = fetcher.mock.calls.length
      try {
        signedOut = true
        expect(await clearUserData()).toBe(true)
        nativeResult.resolve({ kind: 'apps', apps: [] })
        await flushMicrotasks()
        expect(vi.getTimerCount()).toBe(0)
        if (phase === 'request') expect(pendingSignals.every((signal) => signal.aborted)).toBe(true)
        if (phase === 'native') expect(native.cancel).toHaveBeenCalledExactlyOnceWith(id)
        beacon.mockClear()
        window.dispatchEvent(new Event('pagehide'))
        await vi.advanceTimersByTimeAsync(120_000)
        expect(fetcher).toHaveBeenCalledTimes(callsBeforeSignOut)
        expect(beacon).not.toHaveBeenCalled()
        expect(native.execute).toHaveBeenCalledOnce()
        connected = true
        native.execute.mockResolvedValueOnce({ kind: 'apps', apps: [] })
        const next = nextId()
        await executeComputerToolOnClient(next, { action: 'list_apps' }, new Date().toISOString())
        expect(
          copilotConfirmBodySchema.parse(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body)))
        ).toMatchObject({ toolCallId: next, status: 'success' })
        expect(native.execute).toHaveBeenCalledTimes(2)
      } finally {
        connected = true
        nativeResult.resolve({ kind: 'apps', apps: [] })
        pendingResponse.resolve(new Response(null, { status: 200 }))
        await vi.advanceTimersByTimeAsync(120_000)
        await execution
        const cleanup = executeComputerToolOnClient(id, { action: 'list_apps' }, timestamp)
        await vi.advanceTimersByTimeAsync(15_000)
        await cleanup
      }
    }
  )
})
