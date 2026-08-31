/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SandboxCodeResult,
  SandboxCommandResult,
  SandboxHandle,
  SandboxProvider,
} from '@/lib/execution/remote-sandbox/types'

const { mockCreate, mockFindSessionSandbox, mockResolveWorkspaceSandbox } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFindSessionSandbox: vi.fn(),
  mockResolveWorkspaceSandbox: vi.fn(),
}))

vi.mock('@/lib/execution/remote-sandbox/provider', () => ({
  resolveProvider: (): SandboxProvider => ({
    id: 'e2b',
    dependencyStrategy: 'prebuilt',
    resolveLifetimeMs: (ms: number) => ms,
    create: mockCreate,
    findSessionSandbox: mockFindSessionSandbox,
  }),
}))

vi.mock('@/lib/execution/remote-sandbox/resolve', () => ({
  resolveWorkspaceSandbox: mockResolveWorkspaceSandbox,
  provisionRuntimeDependencies: vi.fn(),
  repairMissingSandboxImage: vi.fn().mockResolvedValue(null),
  RUNTIME_INSTALL_TIMEOUT_MS: 60_000,
}))

vi.mock('@/lib/core/execution-limits/metrics', () => ({
  recordSandboxTeardownFailure: vi.fn(),
  recordSandboxProviderLimit: vi.fn(),
}))

import {
  executeInSandbox,
  executeShellInSandbox,
  SIM_RESULT_PREFIX,
} from '@/lib/execution/remote-sandbox'

interface FakeSandboxCalls {
  runCode: Array<{ code: string; envs?: Record<string, string> }>
  runCommand: Array<{ command: string; envs?: Record<string, string> }>
  extendLifetime: number[]
  killed: boolean
}

function fakeSandbox(id: string): { handle: SandboxHandle; calls: FakeSandboxCalls } {
  const calls: FakeSandboxCalls = { runCode: [], runCommand: [], extendLifetime: [], killed: false }
  const codeResult: SandboxCodeResult = {
    text: `${SIM_RESULT_PREFIX}{"ok":true}`,
    stdout: '',
    stderr: '',
  }
  const commandResult: SandboxCommandResult = { stdout: 'ran', stderr: '', exitCode: 0 }
  const handle: SandboxHandle = {
    sandboxId: id,
    async runCode(code, options) {
      calls.runCode.push({ code, ...(options.envs ? { envs: options.envs } : {}) })
      return codeResult
    },
    async runCommand(command, options) {
      calls.runCommand.push({ command, ...(options.envs ? { envs: options.envs } : {}) })
      return commandResult
    },
    async extendLifetime(lifetimeMs) {
      calls.extendLifetime.push(lifetimeMs)
    },
    async getFileSize() {
      return 0
    },
    async readFile() {
      return ''
    },
    async readFileWithLimit() {
      return { content: '', byteLength: 0 }
    },
    async writeFile() {},
    async listFiles() {
      return []
    },
    async kill() {
      calls.killed = true
    },
  }
  return { handle, calls }
}

const CODE_REQUEST = {
  code: 'print(1)',
  language: 'python' as never,
  timeoutMs: 30_000,
}

describe('session sandbox lease', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveWorkspaceSandbox.mockResolvedValue(null)
  })

  it('creates a tagged sandbox, bootstraps it, and keeps it alive', async () => {
    const { handle, calls } = fakeSandbox('sb-fresh')
    mockFindSessionSandbox.mockResolvedValue(null)
    mockCreate.mockResolvedValue(handle)

    const result = await executeInSandbox({
      ...CODE_REQUEST,
      sandboxKind: 'mothership',
      session: { key: 'mothership-chat:c1', bootstrapCommand: 'install-cli' },
    })

    expect(result.sandboxSession).toBe('created')
    expect(mockCreate).toHaveBeenCalledWith(
      'mothership',
      expect.objectContaining({ sessionKey: 'mothership-chat:c1' })
    )
    expect(calls.runCommand.map((c) => c.command)).toContain('install-cli')
    expect(calls.killed).toBe(false)
    expect(calls.extendLifetime.length).toBeGreaterThan(0)
  })

  it('reuses a live session sandbox without creating or killing', async () => {
    const { handle, calls } = fakeSandbox('sb-live')
    mockFindSessionSandbox.mockResolvedValue(handle)

    const result = await executeInSandbox({
      ...CODE_REQUEST,
      sandboxKind: 'mothership',
      session: { key: 'mothership-chat:c1', bootstrapCommand: 'install-cli' },
    })

    expect(result.sandboxSession).toBe('reused')
    expect(mockCreate).not.toHaveBeenCalled()
    // Bootstrap belongs to creation only; a reused sandbox already ran it.
    expect(calls.runCommand.map((c) => c.command)).not.toContain('install-cli')
    expect(calls.killed).toBe(false)
    expect(calls.extendLifetime.length).toBeGreaterThanOrEqual(2)
  })

  it('injects session envs into code executions', async () => {
    const { handle, calls } = fakeSandbox('sb-env')
    mockFindSessionSandbox.mockResolvedValue(handle)

    await executeInSandbox({
      ...CODE_REQUEST,
      sandboxKind: 'mothership',
      session: { key: 'k', envs: { SIM_WORKSPACE: 'ws-1' } },
    })

    expect(calls.runCode[0]?.envs).toMatchObject({ SIM_WORKSPACE: 'ws-1' })
  })

  it('injects session envs into shell executions', async () => {
    const { handle, calls } = fakeSandbox('sb-shell')
    mockFindSessionSandbox.mockResolvedValue(handle)

    const result = await executeShellInSandbox({
      code: 'sim workflows list',
      envs: { USER_VAR: '1' },
      timeoutMs: 30_000,
      sandboxKind: 'mothership',
      session: { key: 'k', envs: { SIM_WORKSPACE: 'ws-1' } },
    })

    expect(result.sandboxSession).toBe('reused')
    expect(calls.runCommand[0]?.envs).toMatchObject({ USER_VAR: '1', SIM_WORKSPACE: 'ws-1' })
    expect(calls.killed).toBe(false)
  })

  it('keeps the one-shot teardown when no session is requested', async () => {
    const { handle, calls } = fakeSandbox('sb-oneshot')
    mockCreate.mockResolvedValue(handle)

    const result = await executeInSandbox({ ...CODE_REQUEST, sandboxKind: 'mothership' })

    expect(result.sandboxSession).toBeUndefined()
    expect(mockFindSessionSandbox).not.toHaveBeenCalled()
    expect(calls.killed).toBe(true)
  })

  it('ignores the session for metered executions', async () => {
    const { handle, calls } = fakeSandbox('sb-metered')
    mockCreate.mockResolvedValue(handle)

    const result = await executeInSandbox({
      ...CODE_REQUEST,
      session: { key: 'k' },
      meterUsage: true,
    })

    expect(result.sandboxSession).toBeUndefined()
    expect(mockFindSessionSandbox).not.toHaveBeenCalled()
    expect(calls.killed).toBe(true)
  })

  it('falls back to a fresh create when the session lookup fails', async () => {
    const { handle, calls } = fakeSandbox('sb-fallback')
    mockFindSessionSandbox.mockRejectedValue(new Error('provider listing down'))
    mockCreate.mockResolvedValue(handle)

    const result = await executeInSandbox({
      ...CODE_REQUEST,
      sandboxKind: 'mothership',
      session: { key: 'k' },
    })

    expect(result.sandboxSession).toBe('created')
    expect(calls.killed).toBe(false)
  })
})
