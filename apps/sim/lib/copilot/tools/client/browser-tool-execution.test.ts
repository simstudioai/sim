/**
 * @vitest-environment jsdom
 */
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteBrowserTool, mockReportCompletion, mockRestoreBrowserScope } = vi.hoisted(
  () => ({
    mockExecuteBrowserTool: vi.fn(),
    mockReportCompletion: vi.fn(),
    mockRestoreBrowserScope: vi.fn(),
  })
)

vi.mock('@/lib/browser-agent/transport', () => ({
  executeBrowserTool: mockExecuteBrowserTool,
  restoreBrowserScope: mockRestoreBrowserScope,
}))
vi.mock('@/lib/copilot/tools/client/completion', () => ({
  reportClientToolCompletion: mockReportCompletion,
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
    window.sessionStorage.clear()
    const session = {
      pageState: null,
      tabs: [],
      activeTabId: null,
      sessionAlive: true,
      suspended: false,
    }
    useBrowserSessionStore.setState({
      ...session,
      activeScopeId: CHAT_SCOPE,
      sessions: { [CHAT_SCOPE]: session },
    })
    mockReportCompletion.mockResolvedValue(undefined)
    mockRestoreBrowserScope.mockResolvedValue(false)
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
      CHAT_SCOPE
    )
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      text: 'page content',
    })
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
        CHAT_SCOPE
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
      scopeId
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
      CHAT_SCOPE
    )
    expect(mockRestoreBrowserScope).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      url: 'https://example.com',
    })
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
      'chat-b'
    )
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      text: 'B page',
    })
  })
})
