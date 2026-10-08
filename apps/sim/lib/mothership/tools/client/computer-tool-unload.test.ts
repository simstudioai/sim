/** @vitest-environment jsdom */
import { Blob as NodeBlob } from 'node:buffer'
import { ComputerUseError } from '@sim/desktop-bridge'
import { type ComputerUseResult, ComputerUseResultSchema } from '@sim/desktop-bridge/computer-use'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copilotConfirmBodySchema } from '@/lib/api/contracts/copilot'
import { executeComputerToolOnClient } from '@/lib/mothership/tools/client/computer-tool-execution'

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

  it('retains confirmed zero-dispatch failure after all delivery paths fail and releases it after replay acknowledgment', async () => {
    native.execute.mockRejectedValueOnce(
      new ComputerUseError({
        code: 'activation_required',
        message: 'Activate first.',
        dispatchState: 'not_started',
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
    const execution = executeComputerToolOnClient(id, { action: 'list_apps' }, timestamp)
    await vi.runAllTimersAsync()
    await execution
    try {
      window.dispatchEvent(new Event('pagehide'))
      await flushMicrotasks()
      expect(bodies).toHaveLength(1)
      expect(copilotConfirmBodySchema.parse(JSON.parse(await bodies[0].text()))).toMatchObject({
        toolCallId: id,
        status: 'error',
        data: {
          code: 'activation_required',
          dispatchState: 'not_started',
          doNotRetry: false,
          outcomeUnknown: false,
        },
      })
      const fallback = fetch.mock.calls.find(([, init]) => init?.keepalive)
      expect(fallback?.[1]?.body).toBe(await bodies[0].text())
      expect(native.cancel).not.toHaveBeenCalled()
    } finally {
      fetch.mockResolvedValue(new Response(null, { status: 200 }))
      await executeComputerToolOnClient(id, { action: 'list_apps' }, timestamp)
    }
    const count = bodies.length
    window.dispatchEvent(new Event('pagehide'))
    expect(bodies).toHaveLength(count)
    expect(
      copilotConfirmBodySchema.parse(JSON.parse(String(fetch.mock.lastCall?.[1]?.body)))
    ).toMatchObject({
      toolCallId: id,
      status: 'error',
      data: { dispatchState: 'not_started', outcomeUnknown: false },
    })
    expect(native.execute).toHaveBeenCalledOnce()
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
})
