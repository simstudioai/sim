/**
 * @vitest-environment node
 *
 * Provider conformance: the same input must produce the same
 * `SandboxExecutionResult` on E2B and on Daytona. A divergence here is exactly
 * what would surface as a broken failover mid-incident, so every scenario runs
 * twice — once per provider — from a single table.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'

const {
  mockEnv,
  mockE2BCreate,
  mockE2BRunCode,
  mockE2BCommandsRun,
  mockE2BFilesRead,
  mockE2BFilesWrite,
  mockE2BKill,
  mockDaytonaCreate,
  mockInterpreterRunCode,
  mockProcessCodeRun,
  mockExecuteCommand,
  mockUploadFile,
  mockDownloadFile,
  mockDelete,
  mockCreateSession,
  mockExecuteSessionCommand,
  mockGetSessionCommandLogs,
  mockGetSessionCommand,
  mockDeleteSession,
} = vi.hoisted(() => ({
  mockEnv: {
    SANDBOX_PROVIDER: 'e2b' as string | undefined,
    E2B_API_KEY: 'test-key',
    MOTHERSHIP_E2B_TEMPLATE_ID: 'mothership-shell',
    MOTHERSHIP_E2B_DOC_TEMPLATE_ID: 'mothership-docs',
    E2B_PI_TEMPLATE_ID: 'sim-pi',
    DAYTONA_API_KEY: 'test-key',
    DAYTONA_SHELL_SNAPSHOT_ID: 'mothership-shell:v1' as string | undefined,
    DAYTONA_DOC_SNAPSHOT_ID: 'mothership-docs:v1' as string | undefined,
    DAYTONA_PI_SNAPSHOT_ID: 'sim-pi:v1' as string | undefined,
  },
  mockE2BCreate: vi.fn(),
  mockE2BRunCode: vi.fn(),
  mockE2BCommandsRun: vi.fn(),
  mockE2BFilesRead: vi.fn(),
  mockE2BFilesWrite: vi.fn(),
  mockE2BKill: vi.fn(),
  mockDaytonaCreate: vi.fn(),
  mockInterpreterRunCode: vi.fn(),
  mockProcessCodeRun: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockUploadFile: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockDelete: vi.fn(),
  mockCreateSession: vi.fn(),
  mockExecuteSessionCommand: vi.fn(),
  mockGetSessionCommandLogs: vi.fn(),
  mockGetSessionCommand: vi.fn(),
  mockDeleteSession: vi.fn(),
}))

vi.mock('@e2b/code-interpreter', () => ({ Sandbox: { create: mockE2BCreate } }))
vi.mock('@daytonaio/sdk', () => ({
  Daytona: class {
    create = mockDaytonaCreate
  },
}))
vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))

import {
  executeInSandbox,
  executeShellInSandbox,
  SIM_RESULT_PREFIX,
  withPiSandbox,
} from '@/lib/execution/remote-sandbox'

type Provider = 'e2b' | 'daytona'
const PROVIDERS: Provider[] = ['e2b', 'daytona']

/** Points the shared layer at one provider via the SANDBOX_PROVIDER env var. */
function useProvider(provider: Provider) {
  mockEnv.SANDBOX_PROVIDER = provider
}

/** Stubs a code execution that prints `stdout` and emits `result` via the marker. */
function stubCodeRun(provider: Provider, stdout: string) {
  if (provider === 'e2b') {
    mockE2BRunCode.mockResolvedValue({
      error: null,
      text: '',
      logs: { stdout: [stdout], stderr: [] },
      results: [],
    })
  } else {
    mockInterpreterRunCode.mockResolvedValue({ stdout, stderr: '', error: undefined })
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  mockE2BCreate.mockResolvedValue({
    sandboxId: 'sb_1',
    runCode: mockE2BRunCode,
    commands: { run: mockE2BCommandsRun },
    files: { read: mockE2BFilesRead, write: mockE2BFilesWrite },
    kill: mockE2BKill,
  })
  mockE2BCommandsRun.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })

  mockDaytonaCreate.mockResolvedValue({
    id: 'sb_1',
    codeInterpreter: { runCode: mockInterpreterRunCode },
    process: {
      codeRun: mockProcessCodeRun,
      executeCommand: mockExecuteCommand,
      createSession: mockCreateSession,
      executeSessionCommand: mockExecuteSessionCommand,
      getSessionCommandLogs: mockGetSessionCommandLogs,
      getSessionCommand: mockGetSessionCommand,
      deleteSession: mockDeleteSession,
    },
    fs: { uploadFile: mockUploadFile, downloadFile: mockDownloadFile },
    delete: mockDelete,
  })
  mockExecuteCommand.mockResolvedValue({ result: '', exitCode: 0 })
  mockExecuteSessionCommand.mockResolvedValue({ cmdId: 'cmd_1' })
  mockGetSessionCommand.mockResolvedValue({ exitCode: 0 })
})

describe.each(PROVIDERS)('sandbox conformance [%s]', (provider) => {
  beforeEach(() => useProvider(provider))

  it('parses the __SIM_RESULT__ marker and strips it from stdout', async () => {
    stubCodeRun(provider, `hello\n${SIM_RESULT_PREFIX}{"ok":true}`)

    const res = await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect(res.result).toEqual({ ok: true })
    expect(res.stdout).toBe('hello')
    expect(res.error).toBeUndefined()
  })

  it('takes the LAST marker so user output cannot shadow the real result', async () => {
    stubCodeRun(
      provider,
      `${SIM_RESULT_PREFIX}{"decoy":true}\nnoise\n${SIM_RESULT_PREFIX}{"real":true}`
    )

    const res = await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect(res.result).toEqual({ real: true })
  })

  it('refuses to return a corrupted marker payload', async () => {
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}{"truncated":`)

    const res = await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect(res.result).toBeNull()
    expect(res.error).toContain('corrupted in transport')
  })

  it('survives a large single-line payload without chunk corruption', async () => {
    const blob = 'x'.repeat(200_000)
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}${JSON.stringify({ blob })}`)

    const res = await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect((res.result as { blob: string }).blob).toHaveLength(200_000)
  })

  it('normalizes execution errors to the same shape', async () => {
    if (provider === 'e2b') {
      mockE2BRunCode.mockResolvedValue({
        error: { name: 'ValueError', value: 'boom', traceback: 'Traceback...\nValueError: boom' },
        text: '',
        logs: { stdout: [], stderr: [] },
      })
    } else {
      mockInterpreterRunCode.mockResolvedValue({
        stdout: '',
        stderr: '',
        error: { name: 'ValueError', value: 'boom', traceback: 'Traceback...\nValueError: boom' },
      })
    }

    const res = await executeInSandbox({
      code: 'raise ValueError("boom")',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect(res.error).toBe('ValueError: boom')
    expect(res.stdout).toContain('ValueError: boom')
    expect(res.result).toBeNull()
  })

  it('fetches url-mounted files inside the sandbox and never inlines the url', async () => {
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)

    await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
      sandboxFiles: [
        { type: 'url', path: '/mnt/data/in.csv', url: 'https://example/presigned?x=1' },
      ],
    })

    const [command, options] =
      provider === 'e2b' ? mockE2BCommandsRun.mock.calls[0] : mockExecuteCommand.mock.calls[0]
    expect(command).toContain('curl')
    // The presigned URL must travel as an env var, never interpolated into the shell.
    expect(command).not.toContain('presigned')
    const envs = provider === 'e2b' ? options.envs : mockExecuteCommand.mock.calls[0][2]
    expect(envs).toMatchObject({ URL: 'https://example/presigned?x=1', DST: '/mnt/data/in.csv' })
  })

  it('throws rather than running user code against a missing mount', async () => {
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockRejectedValue(new Error('curl: (22) 404'))
    } else {
      mockExecuteCommand.mockResolvedValue({ result: 'curl: (22) 404', exitCode: 22 })
    }

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 1000,
        sandboxFiles: [{ type: 'url', path: '/mnt/data/in.csv', url: 'https://example/f' }],
      })
    ).rejects.toThrow(/Failed to fetch mounted file/)
  })

  it('treats a non-JSON shell marker as a plain string, not corruption', async () => {
    const stdout = `${SIM_RESULT_PREFIX}PLAIN_STATUS`
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockResolvedValue({ stdout, stderr: '', exitCode: 0 })
    } else {
      mockExecuteCommand.mockResolvedValue({ result: stdout, exitCode: 0 })
    }

    const res = await executeShellInSandbox({ code: 'echo hi', envs: {}, timeoutMs: 1000 })

    expect(res.result).toBe('PLAIN_STATUS')
    expect(res.error).toBeUndefined()
  })

  it('surfaces a non-zero shell exit as an error', async () => {
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockResolvedValue({ stdout: '', stderr: 'bad', exitCode: 3 })
    } else {
      mockExecuteCommand.mockResolvedValue({ result: 'bad', exitCode: 3 })
    }

    const res = await executeShellInSandbox({ code: 'false', envs: {}, timeoutMs: 1000 })

    expect(res.result).toBeNull()
    expect(res.error).toBeTruthy()
  })

  it('exports binary output files as base64', async () => {
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockResolvedValue({ stdout: 'QkFTRTY0', stderr: '', exitCode: 0 })
    } else {
      mockExecuteCommand.mockResolvedValue({ result: 'QkFTRTY0', exitCode: 0 })
    }

    const res = await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
      outputSandboxPath: '/out/report.xlsx',
    })

    expect(res.exportedFileContent).toBe('QkFTRTY0')
    expect(res.exportedFiles).toEqual({ '/out/report.xlsx': 'QkFTRTY0' })
  })

  it('always kills the sandbox, even when execution throws', async () => {
    if (provider === 'e2b') {
      mockE2BRunCode.mockRejectedValue(new Error('kaboom'))
    } else {
      mockInterpreterRunCode.mockRejectedValue(new Error('kaboom'))
    }

    await expect(
      executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 1000 })
    ).rejects.toThrow('kaboom')

    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
  })
})

describe('provider selection', () => {
  it('routes by SANDBOX_PROVIDER, defaulting to E2B when unset', async () => {
    stubCodeRun('e2b', `${SIM_RESULT_PREFIX}null`)
    stubCodeRun('daytona', `${SIM_RESULT_PREFIX}null`)

    mockEnv.SANDBOX_PROVIDER = undefined
    await executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 1000 })
    expect(mockE2BCreate).toHaveBeenCalledTimes(1)
    expect(mockDaytonaCreate).not.toHaveBeenCalled()

    useProvider('daytona')
    await executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 1000 })
    expect(mockDaytonaCreate).toHaveBeenCalledTimes(1)
  })

  it('throws on an unknown SANDBOX_PROVIDER', async () => {
    mockEnv.SANDBOX_PROVIDER = 'modal'
    await expect(
      executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 1000 })
    ).rejects.toThrow(/Unknown SANDBOX_PROVIDER "modal"/)
  })

  it('resolves SANDBOX_PROVIDER case-insensitively', async () => {
    mockEnv.SANDBOX_PROVIDER = 'Daytona'
    stubCodeRun('daytona', `${SIM_RESULT_PREFIX}null`)

    await executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 1000 })

    expect(mockDaytonaCreate).toHaveBeenCalledTimes(1)
    expect(mockE2BCreate).not.toHaveBeenCalled()
  })

  it('binds language at create time so JS never runs through the Python toolbox', async () => {
    useProvider('daytona')
    mockProcessCodeRun.mockResolvedValue({ result: `${SIM_RESULT_PREFIX}null`, exitCode: 0 })

    await executeInSandbox({ code: 'x', language: CodeLanguage.JavaScript, timeoutMs: 1000 })

    expect(mockDaytonaCreate).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'javascript' })
    )
    // JS must go through process.codeRun — CodeInterpreter is Python-only.
    expect(mockProcessCodeRun).toHaveBeenCalledTimes(1)
    expect(mockInterpreterRunCode).not.toHaveBeenCalled()
  })

  it('fails closed when a Daytona snapshot id is unset', async () => {
    useProvider('daytona')
    const original = mockEnv.DAYTONA_DOC_SNAPSHOT_ID
    mockEnv.DAYTONA_DOC_SNAPSHOT_ID = undefined

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 1000,
        sandboxKind: 'doc',
      })
    ).rejects.toThrow(/DAYTONA_DOC_SNAPSHOT_ID is unset/)
    mockEnv.DAYTONA_DOC_SNAPSHOT_ID = original
  })

  it('accumulates streamed Pi output into stdout/stderr, not just callbacks', async () => {
    useProvider('daytona')
    // Daytona streams via getSessionCommandLogs callbacks; the runner must also
    // return the joined output so the Pi cloud flow can parse markers from stdout
    // and format errors from stderr.
    mockGetSessionCommandLogs.mockImplementation(
      async (
        _sid: string,
        _cid: string,
        onStdout: (c: string) => void,
        onStderr: (c: string) => void
      ) => {
        onStdout('__BASE_SHA__=abc123\n')
        onStderr('warning: detached HEAD\n')
      }
    )
    mockGetSessionCommand.mockResolvedValue({ exitCode: 2 })

    const streamedOut: string[] = []
    const result = await withPiSandbox((runner) =>
      runner.run('git clone ...', {
        timeoutMs: 1000,
        onStdout: (c) => streamedOut.push(c),
      })
    )

    expect(result.stdout).toContain('__BASE_SHA__=abc123')
    expect(result.stderr).toContain('detached HEAD')
    expect(result.exitCode).toBe(2)
    // Callbacks still fire for live streaming.
    expect(streamedOut.join('')).toContain('__BASE_SHA__=abc123')
  })
})
