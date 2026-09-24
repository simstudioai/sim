/** @vitest-environment jsdom */
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
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue({ kind: 'apps', apps: [] })
    mocks.cancel.mockResolvedValue(undefined)
    mocks.complete.mockResolvedValue(undefined)
    mocks.pageExit.mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
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
})
