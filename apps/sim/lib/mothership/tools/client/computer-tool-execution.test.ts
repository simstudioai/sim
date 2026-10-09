/** @vitest-environment jsdom */
import { Blob as NodeBlob } from 'node:buffer'
import { ComputerUseError } from '@sim/desktop-bridge'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  cancel: vi.fn(),
  complete: vi.fn(),
  pageExit: vi.fn(),
}))
vi.mock('@/lib/computer-use/transport', () => ({
  executeComputerUseTool: mocks.execute,
  cancelComputerUseTool: mocks.cancel,
}))
vi.mock('@/lib/mothership/tools/client/completion', () => ({
  reportClientToolCompletion: mocks.complete,
  reportClientToolCompletionOnPageExit: mocks.pageExit,
}))

import { executeComputerToolOnClient } from '@/lib/mothership/tools/client/computer-tool-execution'

let sequence = 0
const nextId = () => `computer-test-${++sequence}`
const now = () => new Date().toISOString()
describe('computer action delivery', () => {
  beforeEach(() => {
    mocks.execute.mockResolvedValue({ kind: 'apps', apps: [] })
    mocks.cancel.mockResolvedValue(undefined)
    mocks.complete.mockResolvedValue(undefined)
    mocks.pageExit.mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['accepted', 'rejected', 'throws'] as const)(
    'flushes a completed action during pending delivery when beacon is %s',
    async (beaconResult) => {
      vi.stubGlobal('Blob', NodeBlob)
      const beacon = vi.fn((_url: string, _blob: NodeBlob) => {
        if (beaconResult === 'throws') throw new Error('Unavailable')
        return beaconResult === 'accepted'
      })
      vi.stubGlobal('navigator', { sendBeacon: beacon })
      const report = createDeferred<void>()
      mocks.complete.mockReturnValueOnce(report.promise)
      mocks.execute.mockResolvedValueOnce({
        kind: 'state',
        bundleId: 'com.example.Fixture',
        snapshotId: 's1',
        windowId: 'w1',
        windows: [{ windowId: 'w1', title: 'Fixture', x: 0, y: 0, width: 400, height: 300 }],
        nodes: [],
        truncated: false,
        screenshot: { base64: 'a'.repeat(80_000), mimeType: 'image/png', width: 1, height: 1 },
      })
      const id = nextId()
      const execution = executeComputerToolOnClient(
        id,
        { action: 'get_app_state', bundleId: 'com.example.Fixture' },
        now()
      )
      await flushMicrotasks()
      try {
        window.dispatchEvent(new Event('pagehide'))
        expect(beacon).toHaveBeenCalledOnce()
        const blob: NodeBlob = beacon.mock.calls[0][1]
        expect(blob.size).toBeLessThanOrEqual(48 * 1024)
        const completion = JSON.parse(await blob.text())
        expect(completion).toMatchObject({
          toolCallId: id,
          status: 'success',
          data: { resultOmittedDuringPageExit: true },
        })
        expect(mocks.cancel).not.toHaveBeenCalled()
        if (beaconResult === 'accepted') expect(mocks.pageExit).not.toHaveBeenCalled()
        else
          expect(mocks.pageExit).toHaveBeenCalledWith(
            id,
            completion.status,
            completion.message,
            completion.data
          )
      } finally {
        report.resolve()
        await execution
      }
      beacon.mockClear()
      window.dispatchEvent(new Event('pagehide'))
      expect(beacon).not.toHaveBeenCalled()
    }
  )

  it.each([true, false])(
    'releases page-exit listeners and delivery capacity only after acknowledgment: %s',
    async (acknowledged) => {
      const beacon = vi.fn(() => false)
      vi.stubGlobal('navigator', { sendBeacon: beacon })
      const ids = Array.from({ length: 8 }, nextId)
      mocks.complete.mockRejectedValue(new Error('offline'))
      if (!acknowledged) mocks.pageExit.mockRejectedValue(new Error('offline'))
      try {
        for (const id of ids) await executeComputerToolOnClient(id, { action: 'list_apps' }, now())
        expect(mocks.execute).toHaveBeenCalledTimes(8)
        window.dispatchEvent(new Event('pagehide'))
        expect(beacon).toHaveBeenCalledTimes(8)
        expect(mocks.cancel).not.toHaveBeenCalled()
        await flushMicrotasks()
        beacon.mockClear()
        window.dispatchEvent(new Event('pagehide'))
        expect(beacon).toHaveBeenCalledTimes(acknowledged ? 0 : 8)
        await flushMicrotasks()
        mocks.complete.mockResolvedValue(undefined)
        await executeComputerToolOnClient(nextId(), { action: 'list_apps' }, now())
        expect(mocks.execute).toHaveBeenCalledTimes(acknowledged ? 9 : 8)
      } finally {
        mocks.complete.mockResolvedValue(undefined)
        for (const id of ids) await executeComputerToolOnClient(id, { action: 'list_apps' }, now())
      }
      expect(mocks.execute).toHaveBeenCalledTimes(acknowledged ? 9 : 8)
    }
  )

  it('keeps a newer retained result when an earlier delivery is acknowledged late', async () => {
    vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => false) })
    const report = createDeferred<void>()
    mocks.complete.mockReturnValueOnce(report.promise)
    const id = nextId()
    const original = executeComputerToolOnClient(id, { action: 'list_apps' }, now())
    await flushMicrotasks()
    try {
      window.dispatchEvent(new Event('pagehide'))
      await flushMicrotasks()
      mocks.complete.mockRejectedValueOnce(new Error('offline'))
      await executeComputerToolOnClient(id, { action: 'list_apps' }, now())
    } finally {
      report.resolve()
      await original
    }
    await executeComputerToolOnClient(id, { action: 'list_apps' })
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.complete).toHaveBeenLastCalledWith(
      id,
      'error',
      expect.stringContaining('may already have run'),
      expect.objectContaining({ doNotRetry: true })
    )
  })

  it('allows the full action budget, then cancels and reports an uncertain result', async () => {
    vi.useFakeTimers()
    mocks.execute.mockImplementationOnce(() => new Promise(() => {}))
    const id = nextId()
    const execution = executeComputerToolOnClient(id, { action: 'list_apps' }, now())

    await vi.advanceTimersByTimeAsync(89_999)
    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await execution
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(id)
    expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(
      id,
      'cancelled',
      expect.stringContaining('timed out'),
      { doNotRetry: true, outcomeUnknown: true }
    )
  })

  it('reports confirmed zero dispatch as recoverable while preserving delivery deduplication', async () => {
    const id = nextId()
    mocks.execute.mockRejectedValueOnce(
      new ComputerUseError({
        code: 'activation_required',
        message: 'Activate and observe the app first.',
        dispatchState: 'not_started',
      })
    )
    mocks.complete.mockRejectedValueOnce(new Error('offline'))
    await executeComputerToolOnClient(id, { action: 'list_apps' }, now())
    await executeComputerToolOnClient(id, { action: 'list_apps' }, now())
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.complete).toHaveBeenLastCalledWith(
      id,
      'error',
      'Activate and observe the app first.',
      {
        code: 'activation_required',
        dispatchState: 'not_started',
        doNotRetry: false,
        outcomeUnknown: false,
      }
    )
    await executeComputerToolOnClient(nextId(), { action: 'list_apps' }, now())
    expect(mocks.execute).toHaveBeenCalledTimes(2)
  })

  it.each([
    new Error('activation_required: not_started'),
    new ComputerUseError({
      code: 'activation_required',
      message: 'Activate and observe the app first.',
    }),
  ])('keeps unknown IPC outcomes protected without explicit native proof', async (error) => {
    const id = nextId()
    mocks.execute.mockRejectedValueOnce(error)
    await executeComputerToolOnClient(id, { action: 'list_apps' }, now())
    expect(mocks.complete).toHaveBeenLastCalledWith(
      id,
      'error',
      expect.any(String),
      expect.objectContaining({ doNotRetry: true, outcomeUnknown: true })
    )
  })

  it('strips UI activity and runs each action only once across redelivery', async () => {
    const id = nextId()
    await executeComputerToolOnClient(
      id,
      { action: 'list_apps', activity: { title: 'Inspecting apps' } },
      now()
    )
    await executeComputerToolOnClient(id, { action: 'list_apps' }, now())
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(
      id,
      { action: 'list_apps' },
      expect.any(AbortSignal)
    )
    expect(mocks.complete).toHaveBeenLastCalledWith(
      id,
      'error',
      expect.stringContaining('may already have run'),
      expect.objectContaining({ doNotRetry: true })
    )
  })
  it.each([undefined, 'invalid', new Date(Date.now() - 121000).toISOString()])(
    'rejects stale or missing timestamps %s',
    async (ts) => {
      await executeComputerToolOnClient(nextId(), { action: 'list_apps' }, ts)
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )
  it('rejects ambiguous target arguments before native dispatch', async () => {
    await executeComputerToolOnClient(
      nextId(),
      {
        action: 'click',
        bundleId: 'com.apple.Notes',
        snapshotId: 's1',
        elementId: 'e1',
        windowId: 'w1',
        x: 1,
        y: 1,
      },
      now()
    )
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('retries result delivery without repeating a native effect', async () => {
    const id = nextId()
    mocks.complete.mockRejectedValueOnce(new Error('offline'))
    await executeComputerToolOnClient(id, { action: 'list_apps' }, now())
    await executeComputerToolOnClient(id, { action: 'list_apps' }, now())
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.complete).toHaveBeenCalledTimes(2)
  })
  it('reports partial input and its observation without repeating the batch on delivery retry', async () => {
    const id = nextId()
    mocks.execute.mockResolvedValueOnce({
      kind: 'action',
      action: 'input_sequence',
      bundleId: 'com.example.Fixture',
      dispatched: true,
      verified: false,
      sequence: { completedSteps: 1, totalSteps: 2, error: 'Editor focus changed.' },
      observation: {
        kind: 'state',
        bundleId: 'com.example.Fixture',
        snapshotId: 'after',
        windowId: '1',
        windows: [],
        nodes: [],
        truncated: false,
      },
    })
    mocks.complete.mockRejectedValueOnce(new Error('offline'))
    const input = {
      action: 'input_sequence',
      bundleId: 'com.example.Fixture',
      snapshotId: 'before',
      elementId: 'editor',
      steps: [
        { action: 'press_key', key: 'Tab' },
        { action: 'type_text', text: 'must not type' },
      ],
      observeAfter: {},
    }
    await executeComputerToolOnClient(id, input, now())
    await executeComputerToolOnClient(id, input, now())
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.complete).toHaveBeenCalledTimes(2)
    expect(mocks.complete).toHaveBeenLastCalledWith(
      id,
      'success',
      expect.stringContaining('stopped after 1/2 completed steps'),
      expect.objectContaining({
        sequence: { completedSteps: 1, totalSteps: 2, error: 'Editor focus changed.' },
        observation: expect.objectContaining({ snapshotId: 'after' }),
      })
    )
  })

  it('cancels native work when Stop aborts the stream', async () => {
    const controller = new AbortController()
    let resolveAction: ((value: { kind: 'apps'; apps: [] }) => void) | undefined
    mocks.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve
        })
    )
    const id = nextId()
    const execution = executeComputerToolOnClient(
      id,
      { action: 'list_apps' },
      now(),
      controller.signal
    )
    controller.abort()
    resolveAction?.({ kind: 'apps', apps: [] })
    await execution
    expect(mocks.cancel).toHaveBeenCalledWith(id)
    expect(mocks.complete).toHaveBeenCalledWith(
      id,
      'cancelled',
      expect.any(String),
      expect.objectContaining({ doNotRetry: true })
    )
  })
  it('does not dispatch a tool when Stop already won', async () => {
    const controller = new AbortController()
    controller.abort()
    await executeComputerToolOnClient(nextId(), { action: 'list_apps' }, now(), controller.signal)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('forwards screenshot bytes as a visual observation with a point coordinate mapping', async () => {
    mocks.execute.mockResolvedValueOnce({
      kind: 'state',
      bundleId: 'com.apple.Notes',
      snapshotId: 's1',
      windowId: 'w1',
      windows: [{ windowId: 'w1', title: 'Notes', x: 20, y: 40, width: 400, height: 300 }],
      nodes: [],
      truncated: false,
      screenshot: { base64: 'YWJj', mimeType: 'image/png', width: 800, height: 600 },
    })
    await executeComputerToolOnClient(
      nextId(),
      { action: 'get_app_state', bundleId: 'com.apple.Notes' },
      now()
    )
    const output = mocks.complete.mock.calls[0][3]
    expect(output).not.toHaveProperty('screenshot')
    expect(output.observations).toEqual([
      { name: 'Computer screenshot', mediaType: 'image/png', data: 'YWJj' },
    ])
    expect(output.content).toContain('x = imageX * 400 / 800')
  })

  it('redelivers the original preflight rejection after delivery recovers', async () => {
    const id = nextId()
    const timestamp = now()
    mocks.complete.mockRejectedValueOnce(new Error('offline'))
    await executeComputerToolOnClient(id, { action: 'invalid' }, timestamp)
    const rejection = mocks.complete.mock.calls[0]
    expect(rejection[2]).toContain('arguments are invalid')
    mocks.complete.mockResolvedValue(undefined)
    await executeComputerToolOnClient(id, { action: 'list_apps' }, timestamp)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.complete).toHaveBeenLastCalledWith(...rejection)
  })

  it('never executes an action rejected during a delivery backlog when the stream replays it', async () => {
    const ids = Array.from({ length: 8 }, nextId)
    const rejectedId = nextId()
    const timestamp = now()
    mocks.execute.mockResolvedValue({ kind: 'apps', apps: [] })
    mocks.complete.mockRejectedValue(new Error('offline'))
    for (const id of ids) await executeComputerToolOnClient(id, { action: 'list_apps' }, timestamp)
    expect(mocks.execute).toHaveBeenCalledTimes(8)
    await executeComputerToolOnClient(rejectedId, { action: 'list_apps' }, timestamp)
    expect(mocks.execute).toHaveBeenCalledTimes(8)
    mocks.complete.mockResolvedValue(undefined)
    for (const id of ids) await executeComputerToolOnClient(id, { action: 'list_apps' }, timestamp)
    await executeComputerToolOnClient(rejectedId, { action: 'list_apps' }, timestamp)
    expect(mocks.execute).toHaveBeenCalledTimes(8)
    expect(mocks.complete).toHaveBeenLastCalledWith(
      rejectedId,
      'error',
      expect.any(String),
      expect.anything()
    )
  })
})
