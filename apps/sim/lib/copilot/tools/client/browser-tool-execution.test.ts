/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteBrowserTool, mockReportCompletion } = vi.hoisted(() => ({
  mockExecuteBrowserTool: vi.fn(),
  mockReportCompletion: vi.fn(),
}))

vi.mock('@/lib/browser-agent/transport', () => ({
  executeBrowserTool: mockExecuteBrowserTool,
}))
vi.mock('@/lib/copilot/tools/client/completion', () => ({
  reportClientToolCompletion: mockReportCompletion,
}))

import { executeBrowserToolOnClient } from '@/lib/copilot/tools/client/browser-tool-execution'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

/** Waits for the fire-and-forget execution promise chain to settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
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
    useBrowserSessionStore.getState().setSessionAlive(true)
    mockReportCompletion.mockResolvedValue(undefined)
  })

  it('executes the tool and reports success when the session is alive', async () => {
    mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    await flush()

    expect(mockExecuteBrowserTool).toHaveBeenCalledWith('browser_snapshot', {}, 30_000)
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      text: 'page content',
    })
  })

  it('rejects page-dependent tools up front when the session is closed', async () => {
    useBrowserSessionStore.getState().setSessionAlive(false)
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    await flush()

    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledWith(
      toolCallId,
      'error',
      expect.stringContaining('browser session is closed'),
      expect.objectContaining({ sessionClosed: true })
    )
  })

  it('still allows session-revival tools when the session is closed', async () => {
    useBrowserSessionStore.getState().setSessionAlive(false)
    mockExecuteBrowserTool.mockResolvedValue({ url: 'https://example.com' })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_navigate', { url: 'https://example.com' })
    await flush()

    expect(mockExecuteBrowserTool).toHaveBeenCalledWith(
      'browser_navigate',
      { url: 'https://example.com' },
      45_000
    )
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      url: 'https://example.com',
    })
  })

  it('tags a failure with sessionClosed when the session died mid-call', async () => {
    mockExecuteBrowserTool.mockImplementation(async () => {
      useBrowserSessionStore.getState().setSessionAlive(false)
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
})
