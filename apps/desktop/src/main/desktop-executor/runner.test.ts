import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TerminalToolResponse } from '@sim/terminal-protocol'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceRequestError } from '@/main/desktop-executor/client'
import type {
  ClaimedDesktopCall,
  DesktopImportEntryRequest,
} from '@/main/desktop-executor/protocol'
import { createDesktopToolRunner, type DesktopToolRunnerDeps } from '@/main/desktop-executor/runner'
import { executeLocalFileRequest } from '@/main/local-files'
import { openNativeFile } from '@/main/native-directory'

vi.mock('electron', () => import('@/test/electron-mock'))

beforeEach(() => {
  vi.mocked(app.getAppPath).mockReturnValue(fileURLToPath(new URL('../../..', import.meta.url)))
})

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
    localFiles: {
      request: (call, request) =>
        executeLocalFileRequest(
          request,
          { toolName: call.toolName, args: call.args },
          {
            path: String(call.args.path),
            resolve: realpath,
            open: async (path, directory = false) => {
              const root = await realpath(dirname(String(call.args.path)))
              return openNativeFile(
                root,
                relative(root, path),
                await stat(root, { bigint: true }),
                directory
              )
            },
          }
        ),
    },
    imports: { importEntry: vi.fn() },
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

describe('background imports', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  /** A `Reports` folder holding `q3/summary.txt` and `notes.txt`. */
  async function reportsFolder(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'sim-runner-import-'))
    roots.push(root)
    const reports = join(root, 'Reports')
    await mkdir(join(reports, 'q3'), { recursive: true })
    await writeFile(join(reports, 'q3', 'summary.txt'), 'quarterly numbers')
    await writeFile(join(reports, 'notes.txt'), 'remember')
    return reports
  }

  function importCall(path: string): ClaimedDesktopCall {
    return {
      toolCallId: 'import-1',
      toolName: 'import_local_files',
      args: { path, targetWorkspaceId: 'ws-1', folderId: 'folder-1' },
      chatId: 'chat-b',
      workspaceId: 'ws-1',
      executionToken: 'token-import-1',
    }
  }

  /**
   * A fake Sim import route: records every entry it stores, with each file's bytes as text, and
   * the token each request presented. `answer` can refuse a request instead.
   */
  function recordingSim(answer?: (request: DesktopImportEntryRequest) => Error | null) {
    const stored: Array<{ kind: string; relativePath: string; text?: string }> = []
    const tokens: string[] = []
    let requests = 0
    const importEntry = async (request: DesktopImportEntryRequest) => {
      requests += 1
      tokens.push(request.call.executionToken)
      const refusal = answer?.(request)
      if (refusal) throw refusal
      stored.push({
        kind: request.kind,
        relativePath: request.relativePath,
        ...(request.content ? { text: await request.content.text() } : {}),
      })
      return { id: `id-${stored.length}`, name: request.relativePath || request.sourceName }
    }
    return { stored, tokens, importEntry, requests: () => requests }
  }

  it("stores a folder's tree in Sim, each file with the bytes on disk", async () => {
    const sim = recordingSim()
    const completion = await runner({ imports: { importEntry: sim.importEntry } }).run(
      importCall(await reportsFolder()),
      new AbortController().signal
    )

    expect(completion.status).toBe('success')
    expect(sim.stored).toEqual([
      { kind: 'directory', relativePath: '' },
      { kind: 'file', relativePath: 'notes.txt', text: 'remember' },
      { kind: 'directory', relativePath: 'q3' },
      { kind: 'file', relativePath: 'q3/summary.txt', text: 'quarterly numbers' },
    ])
    expect(new Set(sim.tokens)).toEqual(new Set(['token-import-1']))
    expect(completion.data).toMatchObject({
      success: true,
      workspaceId: 'ws-1',
      folders: [
        { id: 'id-1', relativePath: '' },
        { id: 'id-3', relativePath: 'q3' },
      ],
      files: [
        { id: 'id-2', relativePath: 'notes.txt' },
        { id: 'id-4', relativePath: 'q3/summary.txt' },
      ],
    })
  })

  it('reports what landed when an import stops part way, and not to retry it', async () => {
    const sim = recordingSim((request) =>
      request.relativePath === 'q3/summary.txt' ? new Error('Sim refused the entry') : null
    )
    const completion = await runner({ imports: { importEntry: sim.importEntry } }).run(
      importCall(await reportsFolder()),
      new AbortController().signal
    )

    expect(completion.status).toBe('error')
    expect(completion.data).toMatchObject({
      success: false,
      partial: true,
      doNotRetry: true,
      outcomeUnknown: true,
      error: 'Sim refused the entry',
      files: [{ id: 'id-2', relativePath: 'notes.txt' }],
    })
  })

  it('stores nothing more once the call is stopped', async () => {
    const controller = new AbortController()
    const sim = recordingSim(() => {
      controller.abort()
      return null
    })
    const completion = await runner({ imports: { importEntry: sim.importEntry } }).run(
      importCall(await reportsFolder()),
      controller.signal
    )

    expect(completion.status).toBe('error')
    expect(sim.stored).toEqual([{ kind: 'directory', relativePath: '' }])
  })

  it("waits out Sim's rate limit instead of failing the import part way", async () => {
    let limited = false
    const sim = recordingSim((request) => {
      if (request.relativePath !== 'notes.txt' || limited) return null
      limited = true
      return new DeviceRequestError(429, 'Too many requests', 10)
    })
    const completion = await runner({ imports: { importEntry: sim.importEntry } }).run(
      importCall(await reportsFolder()),
      new AbortController().signal
    )

    expect(completion.status).toBe('success')
    expect(sim.stored.map((entry) => entry.relativePath)).toEqual([
      '',
      'notes.txt',
      'q3',
      'q3/summary.txt',
    ])
  })

  it('reports an import the rate limit never let start as safe to ask for again', async () => {
    const sim = recordingSim(() => new DeviceRequestError(429, 'Too many requests', 1))
    const completion = await runner({ imports: { importEntry: sim.importEntry } }).run(
      importCall(await reportsFolder()),
      new AbortController().signal
    )

    expect(completion.status).toBe('error')
    expect(completion.data).toMatchObject({ partial: false, files: [], folders: [] })
    expect(completion.data).not.toHaveProperty('doNotRetry')
    expect(completion.data).not.toHaveProperty('outcomeUnknown')
  })

  it('fails without storing anything when the source cannot be read', async () => {
    const sim = recordingSim()
    const completion = await runner({ imports: { importEntry: sim.importEntry } }).run(
      importCall(join(tmpdir(), 'sim-runner-import-missing', 'Reports')),
      new AbortController().signal
    )

    expect(completion.status).toBe('error')
    expect(sim.requests()).toBe(0)
    expect(completion.data).toMatchObject({ workspaceId: 'ws-1', partial: false })
  })
})
