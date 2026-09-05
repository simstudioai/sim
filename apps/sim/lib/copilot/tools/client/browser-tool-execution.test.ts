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
import { BrowserToolReplayLedger } from '@/lib/copilot/tools/client/browser-tool-replay-ledger'
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

function setLiveBrowserSession(): void {
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
    setLiveBrowserSession()
    mockReportCompletion.mockResolvedValue(undefined)
    mockReportCompletionOnPageExit.mockResolvedValue(undefined)
    mockRestoreBrowserScope.mockResolvedValue(false)
    mockCancelBrowserTool.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves every executed completion when a guard result arrives at retention capacity', async () => {
    const replayClaim = vi
      .spyOn(BrowserToolReplayLedger.prototype, 'claim')
      .mockReturnValue('claimed')
    const releases: Array<() => void> = []
    mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
    mockReportCompletion.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve)
        })
    )
    const executedToolCallIds = Array.from({ length: 2_048 }, () => nextToolCallId())
    const overflowGuardToolCallId = nextToolCallId()
    const overflowExecutedToolCallId = nextToolCallId()

    try {
      for (const toolCallId of executedToolCallIds) {
        executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
      }
      await flush()

      expect(mockExecuteBrowserTool).toHaveBeenCalledTimes(executedToolCallIds.length)
      expect(mockReportCompletion).toHaveBeenCalledTimes(4)

      executeBrowserToolOnClient(
        overflowGuardToolCallId,
        'browser_list_sessions',
        {},
        CHAT_SCOPE,
        new Date(Date.now() - 10 * 60_000).toISOString()
      )
      await flush()

      expect(mockReportCompletion).toHaveBeenCalledTimes(4)

      executeBrowserToolOnClient(overflowExecutedToolCallId, 'browser_snapshot', {})
      await flush()

      expect(mockExecuteBrowserTool).toHaveBeenCalledTimes(executedToolCallIds.length)
      expect(replayClaim).toHaveBeenCalledTimes(executedToolCallIds.length)

      mockReportCompletion.mockResolvedValue(undefined)
      for (const release of releases.splice(0)) release()
      await vi.waitFor(
        () => expect(mockReportCompletion).toHaveBeenCalledTimes(executedToolCallIds.length),
        { timeout: 10_000 }
      )

      const reportedToolCallIds = new Set(
        mockReportCompletion.mock.calls.map(([toolCallId]) => toolCallId)
      )
      expect(reportedToolCallIds).toEqual(new Set(executedToolCallIds))
      expect(reportedToolCallIds.has(overflowGuardToolCallId)).toBe(false)
      expect(reportedToolCallIds.has(overflowExecutedToolCallId)).toBe(false)
    } finally {
      mockReportCompletion.mockResolvedValue(undefined)
      for (const release of releases.splice(0)) release()
      replayClaim.mockRestore()
      await flush()
    }
  })

  it('displaces a guard completion for an executed result at retention capacity', async () => {
    const replayClaim = vi
      .spyOn(BrowserToolReplayLedger.prototype, 'claim')
      .mockReturnValue('claimed')
    const releases: Array<() => void> = []
    mockReportCompletion.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve)
        })
    )
    const staleTimestamp = new Date(Date.now() - 10 * 60_000).toISOString()
    const guardToolCallIds = Array.from({ length: 2_048 }, () => nextToolCallId())
    const executedToolCallId = nextToolCallId()

    try {
      for (const toolCallId of guardToolCallIds) {
        executeBrowserToolOnClient(
          toolCallId,
          'browser_list_sessions',
          {},
          CHAT_SCOPE,
          staleTimestamp
        )
      }
      await flush()

      expect(mockReportCompletion).toHaveBeenCalledTimes(4)

      mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
      executeBrowserToolOnClient(executedToolCallId, 'browser_snapshot', {})
      await flush()
      expect(mockExecuteBrowserTool).toHaveBeenCalledOnce()

      releases.shift()?.()
      await flush()
      expect(mockReportCompletion.mock.calls[4]?.[0]).toBe(executedToolCallId)
    } finally {
      mockReportCompletion.mockResolvedValue(undefined)
      for (const release of releases.splice(0)) release()
      replayClaim.mockRestore()
      await flush()
    }
  })

  it('releases scheduler capacity after four timed-out completion deliveries', async () => {
    const rejectors: Array<(reason?: unknown) => void> = []
    mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
    mockReportCompletion.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectors.push(reject)
        })
    )
    const toolCallIds = Array.from({ length: 5 }, () => nextToolCallId())

    for (const toolCallId of toolCallIds) {
      executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    }
    await flush()

    expect(mockReportCompletion).toHaveBeenCalledTimes(4)
    expect(rejectors).toHaveLength(4)

    mockReportCompletion.mockResolvedValue(undefined)
    for (const reject of rejectors) {
      reject(new DOMException('Completion report timed out', 'TimeoutError'))
    }

    await vi.waitFor(() => expect(mockReportCompletion).toHaveBeenCalledTimes(5))
    expect(mockReportCompletion.mock.calls[4]?.[0]).toBe(toolCallIds[4])
    expect(mockReportCompletionOnPageExit).toHaveBeenCalledTimes(4)
  })

  it('keeps an in-flight completion as the replay owner after the retention TTL', async () => {
    const startedAt = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(startedAt)
    let releaseReport: (() => void) | undefined
    mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
    mockReportCompletion.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseReport = resolve
        })
    )
    const toolCallId = nextToolCallId()

    try {
      executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
      await flush()
      expect(mockExecuteBrowserTool).toHaveBeenCalledOnce()
      expect(mockReportCompletion).toHaveBeenCalledOnce()

      now.mockReturnValue(startedAt + 5 * 60_000 + 1)
      executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
      await flush()

      expect(mockExecuteBrowserTool).toHaveBeenCalledOnce()
      expect(mockReportCompletion).toHaveBeenCalledOnce()
      expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
        text: 'page content',
      })
    } finally {
      now.mockRestore()
      releaseReport?.()
      await flush()
    }
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
      90_000,
      CHAT_SCOPE,
      expect.any(Function)
    )
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      text: 'page content',
    })
  })

  it('lets a running invocation own the genuine result when the same call is re-delivered', async () => {
    let finishExecution: (result: { text: string }) => void = () => {}
    mockExecuteBrowserTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishExecution = resolve
        })
    )
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    executeBrowserToolOnClient(
      toolCallId,
      'browser_snapshot',
      {},
      CHAT_SCOPE,
      new Date(Date.now() - 10 * 60_000).toISOString()
    )
    await flush()

    expect(mockExecuteBrowserTool).toHaveBeenCalledOnce()
    expect(mockReportCompletion).not.toHaveBeenCalled()

    finishExecution({ text: 'page content' })
    await flush()

    expect(mockReportCompletion).toHaveBeenCalledOnce()
    expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
      text: 'page content',
    })
  })

  it('does not spend replay-ledger capacity on stale never-executed events', async () => {
    const replayClaim = vi
      .spyOn(BrowserToolReplayLedger.prototype, 'claim')
      .mockReturnValue('claimed')
    const staleTimestamp = new Date(Date.now() - 10 * 60_000).toISOString()
    const staleToolCallIds = Array.from({ length: 2_049 }, () => nextToolCallId())

    try {
      for (const toolCallId of staleToolCallIds) {
        executeBrowserToolOnClient(
          toolCallId,
          'browser_list_sessions',
          {},
          CHAT_SCOPE,
          staleTimestamp
        )
      }
      expect(replayClaim).not.toHaveBeenCalled()

      mockExecuteBrowserTool.mockResolvedValue({ text: 'fresh page content' })
      const freshToolCallId = nextToolCallId()
      executeBrowserToolOnClient(freshToolCallId, 'browser_snapshot', {})
      await flush()

      expect(replayClaim).toHaveBeenCalledOnce()
      expect(replayClaim).toHaveBeenCalledWith(freshToolCallId)
      expect(mockExecuteBrowserTool).toHaveBeenCalledOnce()
      expect(mockExecuteBrowserTool).toHaveBeenCalledWith(
        freshToolCallId,
        'browser_snapshot',
        {},
        90_000,
        CHAT_SCOPE,
        expect.any(Function)
      )
      await vi.waitFor(() =>
        expect(mockReportCompletion).toHaveBeenCalledWith(
          freshToolCallId,
          'success',
          expect.any(String),
          { text: 'fresh page content' }
        )
      )
    } finally {
      replayClaim.mockRestore()
    }
  })

  it('reports an unknown outcome for a durable duplicate with no same-runtime owner', async () => {
    const replayClaim = vi
      .spyOn(BrowserToolReplayLedger.prototype, 'claim')
      .mockReturnValue('duplicate')
    const toolCallId = nextToolCallId()

    try {
      executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
      executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
      await flush()

      expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
      expect(mockReportCompletion).toHaveBeenCalledOnce()
      expect(mockReportCompletion).toHaveBeenCalledWith(
        toolCallId,
        'error',
        expect.stringContaining('terminal result could not be recovered'),
        expect.objectContaining({
          outcomeUnknown: true,
          doNotRetry: true,
          replayRecoveredWithoutResult: true,
        })
      )
    } finally {
      replayClaim.mockRestore()
    }
  })

  it('caps terminal-report concurrency and drains a completion burst', async () => {
    const releases: Array<() => void> = []
    let activeReports = 0
    let maxActiveReports = 0
    mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
    mockReportCompletion.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          activeReports += 1
          maxActiveReports = Math.max(maxActiveReports, activeReports)
          releases.push(() => {
            activeReports -= 1
            resolve()
          })
        })
    )
    const toolCallIds = Array.from({ length: 12 }, () => nextToolCallId())

    for (const toolCallId of toolCallIds) {
      executeBrowserToolOnClient(toolCallId, 'browser_snapshot', {})
    }
    await flush()

    expect(mockReportCompletion).toHaveBeenCalledTimes(4)
    for (let wave = 0; wave < 3; wave += 1) {
      const currentWave = releases.splice(0)
      for (const release of currentWave) release()
      await flush()
    }

    expect(mockReportCompletion).toHaveBeenCalledTimes(toolCallIds.length)
    expect(maxActiveReports).toBe(4)
    for (const release of releases.splice(0)) release()
    await flush()
  })

  it('prioritizes an executed result over a burst of queued guard rejections', async () => {
    const releases: Array<() => void> = []
    mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
    mockReportCompletion.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve)
        })
    )
    for (let index = 0; index < 4; index += 1) {
      executeBrowserToolOnClient(nextToolCallId(), 'browser_snapshot', {})
    }
    await flush()
    expect(mockReportCompletion).toHaveBeenCalledTimes(4)

    const staleTimestamp = new Date(Date.now() - 10 * 60_000).toISOString()
    for (let index = 0; index < 70; index += 1) {
      executeBrowserToolOnClient(
        nextToolCallId(),
        'browser_list_sessions',
        {},
        CHAT_SCOPE,
        staleTimestamp
      )
    }
    const executedToolCallId = nextToolCallId()
    executeBrowserToolOnClient(executedToolCallId, 'browser_snapshot', {})
    await flush()

    releases.shift()?.()
    await flush()
    expect(mockReportCompletion.mock.calls[4]?.[0]).toBe(executedToolCallId)

    mockReportCompletion.mockResolvedValue(undefined)
    for (const release of releases.splice(0)) release()
    await flush()
    await flush()
    expect(mockReportCompletion).toHaveBeenCalledTimes(75)
  })

  it('coalesces duplicate guard delivery while its report is in flight', async () => {
    let finishReport: () => void = () => {}
    mockReportCompletion.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishReport = resolve
        })
    )
    useBrowserSessionStore.setState({ activeScopeId: null })
    const toolCallId = nextToolCallId()

    for (let index = 0; index < 100; index += 1) {
      executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 }, null)
    }
    await flush()

    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledOnce()
    finishReport()
    await flush()
  })

  it('recovers a legacy durable claim without repeating its action', async () => {
    const toolCallId = nextToolCallId()
    window.sessionStorage.setItem(`sim:copilot:browser-tool-executed:${toolCallId}`, '1')

    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    await flush()

    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledWith(
      toolCallId,
      'error',
      expect.stringContaining('terminal result could not be recovered'),
      expect.objectContaining({ outcomeUnknown: true, doNotRetry: true })
    )
  })

  it.each([
    ['browser_snapshot' as const, {}],
    ['browser_list_tabs' as const, {}],
    ['browser_list_sessions' as const, {}],
  ])(
    'keeps observation-only %s usable when the replay claim cannot be persisted',
    async (toolName, params) => {
      const storageWrite = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      })
      mockExecuteBrowserTool.mockResolvedValue({ observed: true })
      const toolCallId = nextToolCallId()

      executeBrowserToolOnClient(toolCallId, toolName, params)
      await flush()

      expect(mockExecuteBrowserTool).toHaveBeenCalledWith(
        toolCallId,
        toolName,
        params,
        90_000,
        CHAT_SCOPE,
        expect.any(Function)
      )
      expect(mockReportCompletion).toHaveBeenCalledWith(toolCallId, 'success', expect.any(String), {
        observed: true,
      })
      storageWrite.mockRestore()
    }
  )

  it.each([
    ['browser_click' as const, { elementId: 1 }],
    ['browser_navigate' as const, { url: 'https://example.com' }],
    ['browser_open_tab' as const, { url: 'https://example.com' }],
  ])(
    'fails closed before stateful %s executes when the replay claim cannot be persisted',
    async (toolName, params) => {
      const storageWrite = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      })
      const toolCallId = nextToolCallId()

      executeBrowserToolOnClient(toolCallId, toolName, params)
      await flush()

      expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
      expect(mockReportCompletion).toHaveBeenCalledWith(
        toolCallId,
        'error',
        expect.stringContaining('replay protection is unavailable'),
        expect.objectContaining({ replayGuardStorageUnavailable: true })
      )
      storageWrite.mockRestore()
    }
  )

  it('uses unload-safe delivery when a stateful replay-guard rejection cannot be reported normally', async () => {
    const storageWrite = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    mockReportCompletion.mockRejectedValueOnce(new Error('confirmation unavailable'))
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    await flush()

    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledWith(
      toolCallId,
      'error',
      expect.stringContaining('replay protection is unavailable'),
      expect.objectContaining({ replayGuardStorageUnavailable: true })
    )
    expect(mockReportCompletionOnPageExit).toHaveBeenCalledWith(
      toolCallId,
      'error',
      expect.stringContaining('replay protection is unavailable'),
      expect.objectContaining({ replayGuardStorageUnavailable: true })
    )
    storageWrite.mockRestore()
  })

  it('retries only terminal delivery after both replay-guard report paths fail', async () => {
    const storageWrite = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    mockReportCompletion.mockRejectedValue(new Error('confirmation unavailable'))
    mockReportCompletionOnPageExit
      .mockRejectedValueOnce(new Error('keepalive unavailable'))
      .mockResolvedValueOnce(undefined)
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    await flush()
    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    await flush()

    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledTimes(2)
    expect(mockReportCompletionOnPageExit).toHaveBeenCalledTimes(2)

    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    await flush()
    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledTimes(2)
    expect(mockReportCompletionOnPageExit).toHaveBeenCalledTimes(2)
    storageWrite.mockRestore()
  })

  it('retries only terminal delivery after replay-guard capacity reporting fails', async () => {
    const replayClaim = vi
      .spyOn(BrowserToolReplayLedger.prototype, 'claim')
      .mockReturnValueOnce('capacity-exhausted')
    mockReportCompletion.mockRejectedValue(new Error('confirmation unavailable'))
    mockReportCompletionOnPageExit
      .mockRejectedValueOnce(new Error('keepalive unavailable'))
      .mockResolvedValueOnce(undefined)
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    await flush()
    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    await flush()
    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    await flush()
    const replayClaimCallCount = replayClaim.mock.calls.length
    replayClaim.mockRestore()

    expect(replayClaimCallCount).toBe(1)
    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledTimes(2)
    expect(mockReportCompletion).toHaveBeenLastCalledWith(
      toolCallId,
      'error',
      expect.stringContaining('replay guard is full'),
      expect.objectContaining({ replayGuardCapacityExceeded: true })
    )
    expect(mockReportCompletionOnPageExit).toHaveBeenCalledTimes(2)
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

  it('retries only a known terminal result after both delivery paths fail', async () => {
    mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
    mockReportCompletion.mockRejectedValue(new Error('confirmation unavailable'))
    mockReportCompletionOnPageExit
      .mockRejectedValueOnce(new Error('keepalive unavailable'))
      .mockResolvedValueOnce(undefined)
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    await flush()
    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    await flush()
    executeBrowserToolOnClient(toolCallId, 'browser_click', { elementId: 1 })
    await flush()

    expect(mockExecuteBrowserTool).toHaveBeenCalledOnce()
    expect(mockReportCompletion).toHaveBeenCalledTimes(2)
    expect(mockReportCompletion).toHaveBeenLastCalledWith(
      toolCallId,
      'success',
      'Browser action completed',
      { text: 'page content' }
    )
    expect(mockReportCompletionOnPageExit).toHaveBeenCalledTimes(2)
  })

  it('preserves an undelivered stateful result for a much later redelivery', async () => {
    vi.useFakeTimers()
    try {
      const emittedAt = new Date('2026-01-01T00:00:00.000Z')
      vi.setSystemTime(emittedAt)
      mockExecuteBrowserTool.mockResolvedValue({ text: 'page content' })
      mockReportCompletion.mockRejectedValueOnce(new Error('confirmation unavailable'))
      mockReportCompletionOnPageExit.mockRejectedValueOnce(new Error('keepalive unavailable'))
      const toolCallId = nextToolCallId()

      executeBrowserToolOnClient(
        toolCallId,
        'browser_click',
        { elementId: 1 },
        CHAT_SCOPE,
        emittedAt.toISOString()
      )
      const firstFlush = flush()
      await vi.advanceTimersByTimeAsync(0)
      await firstFlush
      expect(mockReportCompletionOnPageExit).toHaveBeenCalledOnce()
      vi.setSystemTime(emittedAt.getTime() + 5 * 60_000 + 1)
      mockReportCompletion.mockResolvedValueOnce(undefined)

      executeBrowserToolOnClient(
        toolCallId,
        'browser_click',
        { elementId: 1 },
        CHAT_SCOPE,
        emittedAt.toISOString()
      )
      const secondFlush = flush()
      await vi.advanceTimersByTimeAsync(0)
      await secondFlush

      expect(mockExecuteBrowserTool).toHaveBeenCalledOnce()
      expect(mockReportCompletion).toHaveBeenCalledTimes(2)
      expect(mockReportCompletion).toHaveBeenLastCalledWith(
        toolCallId,
        'success',
        'Browser action completed',
        { text: 'page content' }
      )
      expect(mockReportCompletionOnPageExit).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
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
      let finishReport: () => void = () => {}
      mockReportCompletion.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishReport = resolve
          })
      )
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
      finishReport()
      await flush()
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
      viewport: {
        url: 'https://example.com/pricing',
        title: 'Pricing',
        width: 1024,
        height: 640,
      },
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
    expect(reported.viewport).toMatchObject({ width: 1024, height: 640 })
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

  it('preserves cropped screenshot offsets and explains coordinate conversion', async () => {
    mockExecuteBrowserTool.mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      clip: { x: 20, y: 30, width: 200, height: 100 },
      scale: 2,
    })
    executeBrowserToolOnClient(nextToolCallId(), 'browser_screenshot', { elementId: 0 })
    await flush()

    const reported = mockReportCompletion.mock.calls[0][3]
    expect(reported.clip).toEqual({ x: 20, y: 30, width: 200, height: 100 })
    expect(reported.scale).toBe(2)
    expect(reported.content).toContain('cssX = clip.x + imageX / scale')
    expect(reported.content).toContain('cssY = clip.y + imageY / scale')
  })

  it('gives restored-tab switching the renderer navigation budget', async () => {
    mockExecuteBrowserTool.mockResolvedValue({ tabId: '2', url: 'https://example.com' })
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_switch_tab', { tabId: '2' })
    await flush()

    expect(mockExecuteBrowserTool).toHaveBeenCalledWith(
      toolCallId,
      'browser_switch_tab',
      { tabId: '2' },
      130_000,
      CHAT_SCOPE,
      expect.any(Function)
    )
  })

  /**
   * Shared normalization coerces numeric strings and caps the requested wait
   * at 120 seconds. The renderer adds delivery grace so it cannot abandon the
   * native queue while the desktop is still honoring that same wait.
   */
  it.each([
    ['number', 30_000, 105_000],
    ['numeric string', '30000', 105_000],
    ['absent', undefined, 85_000],
    ['non-numeric', 'soon', 85_000],
    ['zero', 0, 85_000],
    ['negative', -5_000, 85_000],
    ['above the desktop clamp', 500_000, 195_000],
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
      130_000,
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
      90_000,
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

  it('keeps the renderer navigation margin and preserves outcome-unknown guidance', async () => {
    mockExecuteBrowserTool.mockRejectedValue(
      Object.assign(new Error('The browser outcome is unknown.'), { outcomeUnknown: true })
    )
    const toolCallId = nextToolCallId()

    executeBrowserToolOnClient(toolCallId, 'browser_navigate', { url: 'https://example.com' })
    await flush()

    expect(mockExecuteBrowserTool).toHaveBeenCalledWith(
      toolCallId,
      'browser_navigate',
      { url: 'https://example.com' },
      130_000,
      CHAT_SCOPE,
      expect.any(Function)
    )
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
      90_000,
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
    mockReportCompletionOnPageExit.mockResolvedValue(undefined)
  })

  it.each([
    [
      'stale event',
      (toolCallId: string) =>
        executeBrowserToolOnClient(
          toolCallId,
          'browser_list_sessions',
          {},
          'chat-scope-1',
          new Date(Date.now() - 10 * 60_000).toISOString()
        ),
    ],
    [
      'missing scope',
      (toolCallId: string) =>
        executeBrowserToolOnClient(toolCallId, 'browser_list_sessions', {}, null),
    ],
  ])('retains and retries the unload-safe terminal error for a %s', async (_label, execute) => {
    mockReportCompletion.mockRejectedValue(new Error('confirmation unavailable'))
    mockReportCompletionOnPageExit
      .mockRejectedValueOnce(new Error('keepalive unavailable'))
      .mockResolvedValueOnce(undefined)
    const toolCallId = nextToolCallId()

    execute(toolCallId)
    await flush()
    execute(toolCallId)
    await flush()

    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledTimes(2)
    expect(mockReportCompletionOnPageExit).toHaveBeenCalledTimes(2)
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

  it('marks a stale stateful event outcome unknown and unsafe to retry', async () => {
    const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    executeBrowserToolOnClient(
      'stale-stateful-call-1',
      'browser_click',
      { elementId: 1 },
      'chat-scope-1',
      staleTs
    )
    await sleep(0)

    expect(mockExecuteBrowserTool).not.toHaveBeenCalled()
    expect(mockReportCompletion).toHaveBeenCalledWith(
      'stale-stateful-call-1',
      'error',
      expect.stringContaining('may already have taken effect'),
      expect.objectContaining({
        doNotRetry: true,
        outcomeUnknown: true,
        staleEvent: true,
      })
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
