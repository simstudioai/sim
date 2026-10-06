import type { TerminalToolResponse } from '@sim/terminal-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaimedDesktopCall } from '@/main/desktop-executor/protocol'
import { createDesktopToolRunner } from '@/main/desktop-executor/runner'

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

function runnerWithTerminal(executeTool: (toolCallId: string) => Promise<TerminalToolResponse>) {
  return createDesktopToolRunner({
    preferences: () => ({ browserEnabled: true, terminalEnabled: true }),
    accountDataAvailable: () => true,
    browser: {
      executeTool: vi.fn(),
      cancelTool: vi.fn(),
      hasSession: () => true,
      restoreScope: vi.fn(),
    },
    terminal: {
      executeTool: (_scope, toolCallId) => executeTool(toolCallId),
      cancelTool: vi.fn(async () => true),
    },
    localFiles: { read: vi.fn() },
    localFilesystem: { handle: vi.fn(), vfsRoot: () => 'user-local/x--1' },
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
    expect((await first).status).toBe('error')

    const second = runner.run(terminalCall('next', 'read'), new AbortController().signal)
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual(['wedged'])

    releaseWedged({ ok: true, result: {} })
    expect((await second).status).toBe('success')
    expect(started).toEqual(['wedged', 'next'])
  })
})
