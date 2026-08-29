/**
 * @vitest-environment jsdom
 */
import { Blob as NodeBlob } from 'node:buffer'
import { sleep } from '@sim/utils/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCancelBrowserTool,
  mockExecuteBrowserTool,
  mockReportCompletion,
  mockReportCompletionOnPageExit,
  mockRestoreBrowserScope,
} = vi.hoisted(() => ({
  mockCancelBrowserTool: vi.fn(),
  mockExecuteBrowserTool: vi.fn(),
  mockReportCompletion: vi.fn(),
  mockReportCompletionOnPageExit: vi.fn(),
  mockRestoreBrowserScope: vi.fn(),
}))

vi.mock('@/lib/browser-agent/transport', () => ({
  cancelBrowserTool: mockCancelBrowserTool,
  executeBrowserTool: mockExecuteBrowserTool,
  restoreBrowserScope: mockRestoreBrowserScope,
}))
vi.mock('@/lib/copilot/tools/client/completion', () => ({
  reportClientToolCompletion: mockReportCompletion,
  reportClientToolCompletionOnPageExit: mockReportCompletionOnPageExit,
}))

import { executeBrowserToolOnClient } from '@/lib/copilot/tools/client/browser-tool-execution'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

const CHAT_SCOPE = 'chat-test'

/** Waits for the fire-and-forget execution promise chain to settle. */
async function flush(): Promise<void> {
  await sleep(0)
}

let toolCallCounter = 0
function nextToolCallId(): string {
  toolCallCounter += 1
  return `tool-call-${toolCallCounter}`
}

describe('executeBrowserToolOnClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('Blob', NodeBlob)
    window.sessionStorage.clear()
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: vi.fn(() => true),
    })
    const session = {
      pageState: null,
      tabs: [],
      activeTabId: null,
      automationTabId: null,
      automationActive: false,
      automationNeedsAttention: false,
      agentRunIds: [],
      sessionAlive: true,
      suspended: false,
    }
    useBrowserSessionStore.setState({
      ...session,
      activeScopeId: CHAT_SCOPE,
      sessions: { [CHAT_SCOPE]: session },
    })
    mockReportCompletion.mockResolvedValue(undefined)
    mockReportCompletionOnPageExit.mockResolvedValue(undefined)
    mockRestoreBrowserScope.mockResolvedValue(false)
    mockCancelBrowserTool.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('executes the tool and reports success when the session is alive', async () => {
    mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    await flush()

    expect(mockExecuteBrowserTool).toHaveBeenCalledWith(
      toolCallId,
      'browser_snapshot',
      {},
      30_000,
      CHAT_SCOPE,
      expect.any(Function)
    )
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      text: 'page content',
    })
  })

  it('uses unload-safe delivery without reporting a successful action as failed', async () => {
    mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
    mockReportCompletion.mockRejectedValue(new Error('confirmation unavailable'))
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    await flush()

    expect(mockReportCompletion).toHaveBeenCalledOnce()
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      text: 'page content',
    })
    expect(mockReportCompletionOnPageExit).toHaveBeenCalledWith(
      toolCallId,
      'success',
      'Browser action completed',
      { text: 'page content' }
    )
  })

  it('retains a known result for page-exit flush after both delivery attempts fail', async () => {
    mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
    mockReportCompletion.mockRejectedValue(new Error('confirmation unavailable'))
    mockReportCompletionOnPageExit.mockRejectedValue(new Error('keepalive unavailable'))
    const sendBeacon = vi.mocked(navigator.sendBeacon)
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    await flush()
    window.dispatchEvent(new Event('pagehide'))
    await flush()

    expect(mockCancelBrowserTool).not.toHaveBeenCalled()
    expect(sendBeacon).toHaveBeenCalledOnce()
    const beaconPayload = sendBeacon.mock.calls[0]?.[1]
    expect(JSON.parse(await (beaconPayload as NodeBlob).text())).toEqual({
      toolCallId,
      status: 'success',
      message: 'Browser action completed',
      data: { text: 'page content' },
    })
  })

  it('preserves a takeover instruction and waits without a renderer deadline', async () => {
    mockExecuteBrowserTool.mockResolvedValue({
      completed: true,
      userInstruction: 'Open the second match',
    })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_request_takeover', {
      reason: 'Please pick a match',
    })
    await flush()

    expect(mockExecuteBrowserTool).toHaveBeenCalledWith(
      toolCallId,
      'browser_request_takeover',
      { reason: 'Please pick a match' },
      null,
      CHAT_SCOPE,
      expect.any(Function)
    )
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      completed: true,
      userInstruction: 'Open the second match',
    })
  })

  it('cancels the exact native tool and suppresses a stale completion after Chat Stop', async () => {
    let resolveTool: (value: unknown) => void = () => {}
    mockExecuteBrowserTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTool = resolve
        })
    )
    const controller = new AbortController()
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(
      toolCallId,
      'browser_request_takeover',
      { reason: 'Please sign in' },
      CHAT_SCOPE,
      undefined,
      controller.signal
    )
    controller.abort()
    await flush()

    expect(mockCancelBrowserTool).toHaveBeenCalledWith(
      toolCallId,
      CHAT_SCOPE,
      'browser_request_takeover'
    )
    resolveTool({ completed: true })
    await flush()
    expect(mockReportCompletion).not.toHaveBeenCalled()
  })

  it('cancels native work and reports the lost result when the page exits', async () => {
    let resolveTool: (value: unknown) => void = () => {}
    mockExecuteBrowserTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTool = resolve
        })
    )
    const sendBeacon = vi.mocked(navigator.sendBeacon)
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    window.dispatchEvent(new Event('pagehide'))
    await flush()

    expect(mockCancelBrowserTool).toHaveBeenCalledWith(toolCallId, CHAT_SCOPE, 'browser_snapshot')
    expect(sendBeacon).toHaveBeenCalledOnce()
    const beaconPayload = sendBeacon.mock.calls[0]?.[1]
    expect(JSON.parse(await (beaconPayload as NodeBlob).text())).toMatchObject({
      message: expect.stringContaining('may already have taken effect'),
      data: { outcomeUnknown: true, doNotRetry: true },
    })
    resolveTool({ text: 'late result' })
    await flush()
    expect(mockReportCompletion).not.toHaveBeenCalled()
  })

  it('cancels before dispatch and reports the lost result when the page exits during restore', async () => {
    useBrowserSessionStore.getState().setSessionAlive(false, CHAT_SCOPE)
    let finishRestore: () => void = () => {}
    mockRestoreBrowserScope.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishRestore = () => {
            useBrowserSessionStore.getState().setSessionAlive(true, CHAT_SCOPE)
            resolve(true)
          }
        })
    )
    const sendBeacon = vi.mocked(navigator.sendBeacon)
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    window.dispatchEvent(new Event('pagehide'))
    await flush()

    expect(mockCancelBrowserTool).toHaveBeenCalledWith(toolCallId, CHAT_SCOPE, 'browser_snapshot')
    expect(sendBeacon).toHaveBeenCalledOnce()
    const beaconPayload = sendBeacon.mock.calls[0]?.[1]
    expect(JSON.parse(await (beaconPayload as NodeBlob).text())).toMatchObject({
      message: expect.stringContaining('before this browser action started'),
      data: { outcomeUnknown: false, doNotRetry: false },
    })
    finishRestore()
    await flush()
    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).not.toHaveBeenCalled()
  })

  it.each([
    ['not accepted', () => false],
    [
      'throws',
      () => {
        throw new Error('beacon unavailable')
      },
    ],
  ])('falls back to the completion reporter when the page-exit beacon %s', async (_label, send) => {
    mockExecuteBrowserTool.mockImplementation(() => new Promise(() => {}))
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: vi.fn(send),
    })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    window.dispatchEvent(new Event('pagehide'))
    await flush()

    expect(mockCancelBrowserTool).toHaveBeenCalledWith(toolCallId, CHAT_SCOPE, 'browser_click')
    expect(mockReportCompletionOnPageExit).toHaveBeenCalledWith(
      toolCallId,
      'error',
      expect.stringContaining('may already have taken effect'),
      expect.objectContaining({ outcomeUnknown: true, doNotRetry: true })
    )
  })

  it('re-delivers known success when the page exits during confirmation', async () => {
    mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
    let finishReport: () => void = () => {}
    mockReportCompletion.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishReport = resolve
        })
    )
    const sendBeacon = vi.mocked(navigator.sendBeacon)
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    await flush()
    window.dispatchEvent(new Event('pagehide'))
    await flush()

    expect(mockCancelBrowserTool).not.toHaveBeenCalled()
    expect(sendBeacon).toHaveBeenCalledOnce()
    const beaconPayload = sendBeacon.mock.calls[0]?.[1]
    expect(JSON.parse(await (beaconPayload as NodeBlob).text())).toEqual({
      toolCallId,
      status: 'success',
      message: 'Browser action completed',
      data: { text: 'page content' },
    })
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      text: 'page content',
    })
    finishReport()
    await flush()
  })

  it('re-delivers a known native error when the page exits during confirmation', async () => {
    mockExecuteBrowserTool.mockRejectedValue(new Error('element disappeared'))
    let finishReport: () => void = () => {}
    mockReportCompletion.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishReport = resolve
        })
    )
    const sendBeacon = vi.mocked(navigator.sendBeacon)
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    await flush()
    window.dispatchEvent(new Event('pagehide'))
    await flush()

    expect(mockCancelBrowserTool).not.toHaveBeenCalled()
    const beaconPayload = sendBeacon.mock.calls[0]?.[1]
    expect(JSON.parse(await (beaconPayload as NodeBlob).text())).toEqual({
      toolCallId,
      status: 'error',
      message: 'element disappeared',
      data: { error: 'element disappeared' },
    })
    finishReport()
    await flush()
  })

  it('re-delivers a known session-closed error when the page exits during confirmation', async () => {
    useBrowserSessionStore.getState().setSessionAlive(false, CHAT_SCOPE)
    let finishReport: () => void = () => {}
    mockReportCompletion.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishReport = resolve
        })
    )
    const sendBeacon = vi.mocked(navigator.sendBeacon)
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    await flush()
    window.dispatchEvent(new Event('pagehide'))
    await flush()

    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockCancelBrowserTool).not.toHaveBeenCalled()
    const beaconPayload = sendBeacon.mock.calls[0]?.[1]
    expect(JSON.parse(await (beaconPayload as NodeBlob).text())).toMatchObject({
      toolCallId,
      status: 'error',
      data: { sessionClosed: true },
    })
    finishReport()
    await flush()
  })

  it('compacts a large known result before unload-safe delivery', async () => {
    mockExecuteBrowserTool.mockResolvedValue({
      dataUrl: `data:image/jpeg;base64,${'A'.repeat(64 * 1024)}`,
      url: 'https://example.com',
    })
    let finishReport: () => void = () => {}
    mockReportCompletion.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishReport = resolve
        })
    )
    const sendBeacon = vi.mocked(navigator.sendBeacon)
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_screenshot', {})
    await flush()
    window.dispatchEvent(new Event('pagehide'))
    await flush()

    const beaconPayload = sendBeacon.mock.calls[0]?.[1] as NodeBlob
    const payload = JSON.parse(await beaconPayload.text())
    expect(beaconPayload.size).toBeLessThanOrEqual(48 * 1024)
    expect(payload).toMatchObject({
      toolCallId,
      status: 'success',
      data: { resultOmittedDuringPageExit: true },
    })
    expect(payload.data.attachment).toBeUndefined()
    finishReport()
    await flush()
  })

  it.each([
    ['not accepted', () => false],
    [
      'throws',
      () => {
        throw new Error('beacon unavailable')
      },
    ],
  ])(
    'uses keepalive fallback for known success when the page-exit beacon %s',
    async (_label, send) => {
      mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
      mockReportCompletion.mockImplementation(() => new Promise<void>(() => {}))
      Object.defineProperty(navigator, 'sendBeacon', {
        configurable: true,
        value: vi.fn(send),
      })
      const toolCallId = nextToolCallId()

      executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
      await flush()
      window.dispatchEvent(new Event('pagehide'))
      await flush()

      expect(mockCancelBrowserTool).not.toHaveBeenCalled()
      expect(mockReportCompletionOnPageExit).toHaveBeenCalledWith(
        toolCallId,
        'success',
        'Browser action completed',
        { text: 'page content' }
      )
    }
  )

  it('suppresses completion when scope cancellation outlives the stream AbortController', async () => {
    let resolveTool: (value: unknown) => void = () => {}
    let markCancelled: (() => void) | undefined
    mockExecuteBrowserTool.mockImplementation(
      (
        _toolCallId: string,
        _toolName: string,
        _params: Record<string, unknown>,
        _timeoutMs: number | null,
        _scopeId: string,
        onCancel: () => void
      ) => {
        markCancelled = onCancel
        return new Promise((resolve) => {
          resolveTool = resolve
        })
      }
    )
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(
      toolCallId,
      'browser_request_takeover',
      { reason: 'Please sign in' },
      CHAT_SCOPE
    )
    markCancelled?.()
    resolveTool({ completed: true })
    await flush()

    expect(mockReportCompletion).not.toHaveBeenCalled()
  })

  it('delegates older-shell takeover cancellation to the shared transport fallback', async () => {
    mockExecuteBrowserTool.mockImplementation(() => new Promise(() => {}))
    const controller = new AbortController()
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(
      toolCallId,
      'browser_request_takeover',
      { reason: 'Please sign in' },
      CHAT_SCOPE,
      undefined,
      controller.signal
    )
    controller.abort()
    await flush()

    expect(mockCancelBrowserTool).toHaveBeenCalledWith(
      toolCallId,
      CHAT_SCOPE,
      'browser_request_takeover'
    )
    expect(mockReportCompletion).not.toHaveBeenCalled()
  })

  it('does not dispatch a takeover after Stop wins a session restore race', async () => {
    useBrowserSessionStore.getState().setSessionAlive(false, CHAT_SCOPE)
    let finishRestore: () => void = () => {}
    mockRestoreBrowserScope.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishRestore = () => {
            useBrowserSessionStore.getState().setSessionAlive(true, CHAT_SCOPE)
            resolve(true)
          }
        })
    )
    const controller = new AbortController()
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(
      toolCallId,
      'browser_request_takeover',
      { reason: 'Please sign in' },
      CHAT_SCOPE,
      undefined,
      controller.signal
    )
    await flush()
    controller.abort()
    finishRestore()
    await flush()

    expect(mockCancelBrowserTool).toHaveBeenCalledWith(
      toolCallId,
      CHAT_SCOPE,
      'browser_request_takeover'
    )
    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).not.toHaveBeenCalled()
  })

  // The copilot serializes a result carrying this `attachment` shape into a
  // real image content block, so the data URL has to be reshaped rather than
  // passed through — an inline data URL would be charged against the tool
  // result budget as text and shown to the model as a base64 string.
  it('reshapes a screenshot into an image attachment the model can see', async () => {
    mockExecuteBrowserTool.mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      url: 'https://example.com/pricing',
      width: 1024,
      height: 640,
    })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_screenshot', {})
    await flush()

    const [, , , reported] = mockReportCompletion.mock.calls[0]
    expect(reported.attachment).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' },
    })
    expect(reported.content).toContain('https://example.com/pricing')
    expect(reported.dataUrl).toBeUndefined()
    expect(reported.width).toBe(1024)
  })

  it('falls back to a note when a screenshot is not a usable data URL', async () => {
    mockExecuteBrowserTool.mockResolvedValue({ dataUrl: 'not-a-data-url', url: 'https://x.dev' })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_screenshot', {})
    await flush()

    const [, , , reported] = mockReportCompletion.mock.calls[0]
    expect(reported.attachment).toBeUndefined()
    expect(reported.note).toContain('could not be encoded')
  })

  // The desktop driver parses browser_wait_for.timeoutMs with a lenient num()
  // that coerces numeric strings, then clamps to 120s. This side has to match:
  // budgeting less time than the desktop actually waits makes the renderer
  // abort first, which strands the native promise on the serialized tool queue
  // and stalls every later browser call behind it.
  it.each([
    ['number', 30_000, 45_000],
    ['numeric string', '30000', 45_000],
    ['absent', undefined, 25_000],
    ['non-numeric', 'soon', 25_000],
    ['zero', 0, 25_000],
    ['negative', -5_000, 25_000],
    ['above the desktop clamp', 500_000, 135_000],
  ])(
    'budgets browser_wait_for above the desktop wait (%s)',
    async (_label, timeoutMs, expected) => {
      mockExecuteBrowserTool.mockResolvedValue({ found: true })
      const toolCallId = nextToolCallId()
      const params = timeoutMs === undefined ? {} : { timeoutMs }

      executeBrowserToolOnClient(toolCallId, 'browser_wait_for', params)
      await flush()

      expect(mockExecuteBrowserTool).toHaveBeenCalledWith(
        toolCallId,
        'browser_wait_for',
        params,
        expected,
        CHAT_SCOPE,
        expect.any(Function)
      )
    }
  )

  it('rejects page-dependent tools up front when the session is closed', async () => {
    useBrowserSessionStore.getState().setSessionAlive(false, CHAT_SCOPE)
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    await flush()

    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockRestoreBrowserScope).toHaveBeenCalledWith(CHAT_SCOPE)
    expect(mockReportCompletion).toHaveBeenCalledWith(
      toolCallId,
      'error',
      expect.stringContaining('browser session is closed'),
      expect.objectContaining({ sessionClosed: true })
    )
  })

  it.each([
    ['browser_snapshot' as const, {}],
    ['browser_click' as const, { elementId: 1 }],
    ['browser_read_text' as const, {}],
    ['browser_go_back' as const, {}],
  ])('wakes a restored scoped session before executing %s', async (toolName, params) => {
    const scopeId = 'chat-restored'
    useBrowserSessionStore.getState().setSessionAlive(false, scopeId)
    mockRestoreBrowserScope.mockImplementation(async (restoredScopeId: string) => {
      useBrowserSessionStore.getState().setSessionAlive(true, restoredScopeId)
      return true
    })
    mockExecuteBrowserTool.mockResolvedValue({ ok: true })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, toolName, params, scopeId)
    await flush()

    expect(mockRestoreBrowserScope).toHaveBeenCalledWith(scopeId)
    expect(mockExecuteBrowserTool).toHaveBeenCalledWith(
      toolCallId,
      toolName,
      params,
      expect.any(Number),
      scopeId,
      expect.any(Function)
    )
    expect(mockRestoreBrowserScope.mock.invocationCallOrder[0]).toBeLessThan(
      mockExecuteBrowserTool.mock.invocationCallOrder[0]
    )
  })

  it('still allows session-revival tools when the session is closed', async () => {
    useBrowserSessionStore.getState().setSessionAlive(false, CHAT_SCOPE)
    mockExecuteBrowserTool.mockResolvedValue({ url: 'https://example.com' })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_navigate', { url: 'https://example.com' })
    await flush()

    expect(mockExecuteBrowserTool).toHaveBeenCalledWith(
      toolCallId,
      'browser_navigate',
      { url: 'https://example.com' },
      45_000,
      CHAT_SCOPE,
      expect.any(Function)
    )
    expect(mockRestoreBrowserScope).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      url: 'https://example.com',
    })
  })

  it('lists known sessions without restoring a closed page scope', async () => {
    useBrowserSessionStore.getState().setSessionAlive(false, CHAT_SCOPE)
    mockExecuteBrowserTool.mockResolvedValue({ sessions: [] })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_list_sessions', {})
    await flush()

    expect(mockRestoreBrowserScope).not.toHaveBeenCalled()
    expect(mockExecuteBrowserTool).toHaveBeenCalledWith(
      toolCallId,
      'browser_list_sessions',
      {},
      30_000,
      CHAT_SCOPE,
      expect.any(Function)
    )
  })

  it('tags a failure with sessionClosed when the session died mid-call', async () => {
    mockExecuteBrowserTool.mockImplementation(async () => {
      useBrowserSessionStore.getState().setSessionAlive(false, CHAT_SCOPE)
      throw new Error('The browser did not respond within 30000ms')
    })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    await flush()

    expect(mockReportCompletion).toHaveBeenCalledWith(
      toolCallId,
      'error',
      expect.stringContaining('browser session is closed'),
      expect.objectContaining({
        sessionClosed: true,
        error: expect.stringContaining('The browser did not respond within 30000ms'),
      })
    )
  })

  it('reports a plain error without the sessionClosed tag when the session is alive', async () => {
    mockExecuteBrowserTool.mockRejectedValue(new Error('element not found'))
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_click', { ref: 'e12' })
    await flush()

    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'error', 'element not found', {
      error: 'element not found',
    })
  })

  it('preserves structured do-not-retry guidance for an outcome-unknown timeout', async () => {
    mockExecuteBrowserTool.mockRejectedValue(
      Object.assign(new Error('The browser outcome is unknown.'), { outcomeUnknown: true })
    )
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_click', { ref: 'e12' })
    await flush()

    expect(mockReportCompletion).toHaveBeenCalledWith(
      toolCallId,
      'error',
      'The browser outcome is unknown.',
      {
        error: 'The browser outcome is unknown.',
        outcomeUnknown: true,
        doNotRetry: true,
      }
    )
  })

  it('checks and executes against the originating chat rather than the active projection', async () => {
    const store = useBrowserSessionStore.getState()
    store.setSessionAlive(false, 'chat-a')
    store.setSessionAlive(true, 'chat-b')
    store.activateScope('chat-a')
    mockExecuteBrowserTool.mockResolvedValue({ text: 'B page' })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {}, 'chat-b')
    await flush()

    expect(mockExecuteBrowserTool).toHaveBeenCalledWith(
      toolCallId,
      'browser_snapshot',
      {},
      30_000,
      'chat-b',
      expect.any(Function)
    )
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      text: 'B page',
    })
  })
})

describe('pre-dispatch drops still resolve the waiter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReportCompletion.mockResolvedValue(undefined)
  })

  it('reports an error confirmation for a stale event instead of hanging the turn', async () => {
    const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    executeBrowserToolOnClient('stale-call-1', 'browser_list_sessions', {}, 'chat-scope-1', staleTs)
    await sleep(0)

    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledWith(
      'stale-call-1',
      'error',
      expect.stringContaining('too late'),
      expect.objectContaining({ staleEvent: true })
    )
  })

  it('reports an error confirmation when no chat scope exists', async () => {
    useBrowserSessionStore.setState({ activeScopeId: null })
    executeBrowserToolOnClient('no-scope-1', 'browser_list_sessions', {}, undefined)
    await sleep(0)

    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledWith(
      'no-scope-1',
      'error',
      expect.stringContaining('no active browser session'),
      expect.anything()
    )
  })
})
