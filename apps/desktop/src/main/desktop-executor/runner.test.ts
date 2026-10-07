import type { TerminalToolResponse } from '@sim/terminal-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaimedDesktopCall } from '@/main/desktop-executor/protocol'
import { createDesktopToolRunner, type DesktopToolRunnerDeps } from '@/main/desktop-executor/runner'

function terminalCall(toolCallId: string, operation: string): ClaimedDesktopCall {
  return {
    toolCallId,
    toolName: 'terminal',
    args: { operation, args: {} },
    chatId: 'chat-b',
    workspaceId: 'ws-1',
    executionToken: `token-${toolCallId}`,
  }
}

function runner(overrides: Partial<DesktopToolRunnerDeps> = {}) {
  return createDesktopToolRunner({
    preferences: () => ({ browserEnabled: true, terminalEnabled: true }),
    accountDataAvailable: () => true,
    browser: {
      executeTool: vi.fn(),
      cancelTool: vi.fn(),
      hasSession: () => true,
      restoreScope: vi.fn(),
    },
    terminal: { executeTool: vi.fn(), cancelTool: vi.fn(async () => true) },
    localFiles: { read: vi.fn() },
    localFilesystem: { handle: vi.fn(), vfsRoot: () => 'user-local/x--1' },
    ...overrides,
  })
}

function runnerWithTerminal(executeTool: (toolCallId: string) => Promise<TerminalToolResponse>) {
  return runner({
    terminal: {
      executeTool: (_scope, toolCallId) => executeTool(toolCallId),
      cancelTool: vi.fn(async () => true),
    },
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('background terminal calls', () => {
  it('holds a chat terminal for an operation that outlived its deadline', async () => {
    vi.useFakeTimers()
    let releaseWedged: (response: TerminalToolResponse) => void = () => {}
    const started: string[] = []
    const runner = runnerWithTerminal((toolCallId) => {
      started.push(toolCallId)
      if (toolCallId === 'wedged')
        return new Promise((resolve) => {
          releaseWedged = resolve
        })
      return Promise.resolve({ ok: true, result: { output: '' } })
    })

    const first = runner.run(terminalCall('wedged', 'input'), new AbortController().signal)
    await vi.advanceTimersByTimeAsync(15_000)
    const timedOut = await first
    expect(timedOut.status).toBe('error')
    expect(timedOut.data).toMatchObject({ outcomeUnknown: true, doNotRetry: true })

    const second = runner.run(terminalCall('next', 'read'), new AbortController().signal)
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual(['wedged'])

    releaseWedged({ ok: true, result: {} })
    expect((await second).status).toBe('success')
    expect(started).toEqual(['wedged', 'next'])
  })

  it('never starts a terminal operation stopped while it waited for the chat terminal', async () => {
    vi.useFakeTimers()
    let releaseWedged: (response: TerminalToolResponse) => void = () => {}
    const started: string[] = []
    const runner = runnerWithTerminal((toolCallId) => {
      started.push(toolCallId)
      if (toolCallId === 'wedged')
        return new Promise((resolve) => {
          releaseWedged = resolve
        })
      return Promise.resolve({ ok: true, result: { output: '' } })
    })
    const first = runner.run(terminalCall('wedged', 'input'), new AbortController().signal)
    await vi.advanceTimersByTimeAsync(15_000)
    await first

    const stop = new AbortController()
    const second = runner.run(terminalCall('stopped', 'run'), stop.signal)
    await vi.advanceTimersByTimeAsync(0)
    stop.abort()
    const completion = await second
    releaseWedged({ ok: true, result: {} })
    await vi.advanceTimersByTimeAsync(0)

    expect(completion.status).toBe('error')
    expect(started).toEqual(['wedged'])
  })
})

describe('local file calls', () => {
  it('names a passing storage state, not a setting, when local files are out of reach', async () => {
    const completion = await runner({ accountDataAvailable: () => false }).run(
      {
        toolCallId: 'read-1',
        toolName: 'read_local_file',
        args: { path: '~/notes.txt' },
        chatId: 'chat-b',
        workspaceId: 'ws-1',
        executionToken: 'token-read-1',
      },
      new AbortController().signal
    )

    expect(completion.data).toMatchObject({ notStarted: true })
    expect(completion.message).toContain('cannot reach local files')
    expect(completion.message).not.toContain('settings')
  })
})
