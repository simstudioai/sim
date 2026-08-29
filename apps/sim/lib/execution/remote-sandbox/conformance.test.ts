/**
 * @vitest-environment node
 *
 * Provider conformance: the same input must produce the same
 * `SandboxExecutionResult` on E2B and on Daytona. A divergence here is exactly
 * what would surface as a broken failover mid-incident, so every scenario runs
 * twice — once per provider — from a single table.
 */
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'
import { SANDBOX_OUTPUT_DIR_SENTINEL } from '@/lib/execution/remote-sandbox/sandbox-paths'

const {
  mockResolveSandbox,
  mockProvisionRuntime,
  mockEnv,
  mockE2BCreate,
  mockE2BRunCode,
  mockE2BCommandsRun,
  mockE2BCommandsConnect,
  mockE2BFilesGetInfo,
  mockE2BFilesRead,
  mockE2BFilesRemove,
  mockE2BFilesWrite,
  mockE2BFilesList,
  mockE2BKill,
  mockDaytonaCreate,
  mockInterpreterRunCode,
  mockProcessCodeRun,
  mockExecuteCommand,
  mockGetFileDetails,
  mockListFiles,
  mockUploadFile,
  mockDownloadFile,
  mockDownloadFileStream,
  mockCreateFolder,
  mockDeleteFile,
  mockDelete,
  mockCreateSession,
  mockExecuteSessionCommand,
  mockGetSessionCommandLogs,
  mockGetSessionCommand,
  mockSendSessionCommandInput,
  mockDeleteSession,
  mockRecordSandboxProviderLimit,
  mockRecordSandboxTeardownFailure,
} = vi.hoisted(() => ({
  mockResolveSandbox: vi.fn(),
  mockProvisionRuntime: vi.fn(),
  mockEnv: {
    SANDBOX_PROVIDER: 'e2b' as string | undefined,
    PI_SANDBOX_LIFETIME_MS: undefined as string | undefined,
    E2B_ENABLED: 'true',
    E2B_API_KEY: 'test-key',
    E2B_FUNCTION_TEMPLATE_ID: 'sim-function:f47ac10b-58cc-4372-a567-0e02b2c3d479' as
      | string
      | undefined,
    E2B_FUNCTION_TEMPLATE_GENERATION: '1785792000000' as string | undefined,
    MOTHERSHIP_E2B_TEMPLATE_ID: 'mothership-shell',
    MOTHERSHIP_E2B_DOC_TEMPLATE_ID: 'mothership-docs',
    E2B_PI_TEMPLATE_ID: 'sim-pi',
    DAYTONA_API_KEY: 'test-key',
    DAYTONA_FUNCTION_SNAPSHOT_ID: '7d9d12d6-5f2a-44df-9cc2-a20203f3813b' as string | undefined,
    DAYTONA_SHELL_SNAPSHOT_ID: 'mothership-shell:v1' as string | undefined,
    DAYTONA_DOC_SNAPSHOT_ID: 'mothership-docs:v1' as string | undefined,
    DAYTONA_PI_SNAPSHOT_ID: 'sim-pi:v1' as string | undefined,
  },
  mockE2BCreate: vi.fn(),
  mockE2BRunCode: vi.fn(),
  mockE2BCommandsRun: vi.fn(),
  mockE2BCommandsConnect: vi.fn(),
  mockE2BFilesGetInfo: vi.fn(),
  mockE2BFilesRead: vi.fn(),
  mockE2BFilesRemove: vi.fn(),
  mockE2BFilesWrite: vi.fn(),
  mockE2BFilesList: vi.fn(),
  mockE2BKill: vi.fn(),
  mockDaytonaCreate: vi.fn(),
  mockInterpreterRunCode: vi.fn(),
  mockProcessCodeRun: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockGetFileDetails: vi.fn(),
  mockListFiles: vi.fn(),
  mockUploadFile: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockDownloadFileStream: vi.fn(),
  mockCreateFolder: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockDelete: vi.fn(),
  mockCreateSession: vi.fn(),
  mockExecuteSessionCommand: vi.fn(),
  mockGetSessionCommandLogs: vi.fn(),
  mockGetSessionCommand: vi.fn(),
  mockSendSessionCommandInput: vi.fn(),
  mockDeleteSession: vi.fn(),
  mockRecordSandboxProviderLimit: vi.fn(),
  mockRecordSandboxTeardownFailure: vi.fn(),
}))

vi.mock('@e2b/code-interpreter', () => ({ Sandbox: { create: mockE2BCreate } }))
vi.mock('@daytona/sdk', () => ({
  Daytona: class {
    create = mockDaytonaCreate
  },
}))
vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))
vi.mock('@/lib/core/execution-limits/metrics', () => ({
  recordSandboxProviderLimit: mockRecordSandboxProviderLimit,
  recordSandboxTeardownFailure: mockRecordSandboxTeardownFailure,
}))
vi.mock('@/lib/execution/remote-sandbox/resolve', () => ({
  resolveWorkspaceSandbox: mockResolveSandbox,
  provisionRuntimeDependencies: mockProvisionRuntime,
  invalidateSandboxResolution: vi.fn(),
  RUNTIME_INSTALL_TIMEOUT_MS: 240_000,
}))

import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import {
  executeInSandbox,
  executeShellInSandbox,
  SIM_RESULT_PREFIX,
  withPiSandbox,
} from '@/lib/execution/remote-sandbox'
import { daytonaProvider } from '@/lib/execution/remote-sandbox/daytona'
import { E2B_MAX_SANDBOX_LIFETIME_MS, e2bProvider } from '@/lib/execution/remote-sandbox/e2b'
import {
  MAX_SANDBOX_OUTPUT_BYTES,
  MAX_SANDBOX_PROCESS_OUTPUT_BYTES,
  MAX_SANDBOX_STREAMED_OUTPUT_TAIL_BYTES,
} from '@/lib/execution/remote-sandbox/output-limits'
import {
  PI_SANDBOX_MIN_LIFETIME_MS,
  resolvePiSandboxLifetimeMs,
} from '@/lib/execution/remote-sandbox/pi-lifetime'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'

type Provider = 'e2b' | 'daytona'
const PROVIDERS: Provider[] = ['e2b', 'daytona']

/** Points the shared layer at one provider via the SANDBOX_PROVIDER env var. */
function useProvider(provider: Provider) {
  mockEnv.SANDBOX_PROVIDER = provider
}

function providerTimeoutError(provider: Provider): Error {
  const error = new Error(
    provider === 'e2b'
      ? 'Execution timed out — the timeoutMs option was reached'
      : 'Execution timed out: operation exceeded the configured timeout'
  )
  error.name = provider === 'e2b' ? 'TimeoutError' : 'DaytonaTimeoutError'
  return error
}

function emitDaytonaStreamReady(onStdout: (chunk: string) => void): void {
  const command = mockExecuteSessionCommand.mock.calls.at(-1)?.[1]?.command
  if (typeof command === 'string' && command.includes('__SIM_DAYTONA_STREAM_READY__')) {
    onStdout('__SIM_DAYTONA_STREAM_READY__\n')
  }
}

/** Stubs a code execution that prints `stdout` and emits `result` via the marker. */
function stubCodeRun(provider: Provider, stdout: string) {
  if (provider === 'e2b') {
    mockE2BCommandsRun.mockResolvedValue({ stdout, stderr: '', exitCode: 0 })
  } else {
    mockGetSessionCommandLogs.mockImplementation(
      async (_sessionId: string, _commandId: string, onStdout: (chunk: string) => void) => {
        emitDaytonaStreamReady(onStdout)
        if (stdout) onStdout(stdout)
      }
    )
    mockGetSessionCommand.mockResolvedValue({ exitCode: 0 })
  }
}

function stubOutputFileSizes(provider: Provider, ...sizes: number[]) {
  for (const size of sizes) {
    if (provider === 'e2b') {
      mockE2BFilesGetInfo.mockResolvedValueOnce({ size, type: 'file' })
    } else {
      mockGetFileDetails.mockResolvedValueOnce({ size, isDir: false, mode: '-rw-r--r--' })
    }
  }
}

function stubOutputFileRead(provider: Provider, content: string | Uint8Array, onRead?: () => void) {
  if (provider === 'e2b') {
    mockE2BFilesRead.mockImplementationOnce(async () => {
      onRead?.()
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(typeof content === 'string' ? Buffer.from(content) : content)
          controller.close()
        },
      })
    })
  } else {
    mockDownloadFileStream.mockImplementationOnce(async () => {
      onRead?.()
      return Readable.from([typeof content === 'string' ? Buffer.from(content) : content])
    })
  }
}

function stubShellCommand(provider: Provider, stdout: string, stderr: string, exitCode: number) {
  if (provider === 'e2b') {
    mockE2BCommandsRun.mockResolvedValueOnce({ stdout, stderr, exitCode })
    return
  }
  mockGetSessionCommandLogs.mockImplementationOnce(
    async (
      _sessionId: string,
      _commandId: string,
      onStdout: (chunk: string) => void,
      onStderr: (chunk: string) => void
    ) => {
      emitDaytonaStreamReady(onStdout)
      if (stdout) onStdout(stdout)
      if (stderr) onStderr(stderr)
    }
  )
  mockGetSessionCommand.mockResolvedValueOnce({ exitCode })
}

interface CapturedSandboxWrite {
  path: string
  content: unknown
  order: number
}

function capturedSandboxWrites(provider: Provider): CapturedSandboxWrite[] {
  if (provider === 'e2b') {
    return mockE2BFilesWrite.mock.calls
      .map((call, index) => ({
        path: String(call[0]),
        content: call[1],
        order: mockE2BFilesWrite.mock.invocationCallOrder[index],
      }))
      .filter((write) => !write.path.includes('.sim-function-'))
  }
  return mockUploadFile.mock.calls
    .map((call, index) => ({
      path: String(call[1]),
      content: call[0],
      order: mockUploadFile.mock.invocationCallOrder[index],
    }))
    .filter((write) => !write.path.includes('.sim-function-'))
}

function sandboxWriteBuffer(content: unknown): Buffer {
  if (typeof content === 'string') return Buffer.from(content)
  if (content instanceof ArrayBuffer) return Buffer.from(content)
  if (ArrayBuffer.isView(content)) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength)
  }
  throw new Error('Unexpected sandbox write content')
}

beforeEach(() => {
  vi.resetAllMocks()

  mockE2BCreate.mockResolvedValue({
    sandboxId: 'sb_1',
    runCode: mockE2BRunCode,
    commands: { run: mockE2BCommandsRun, connect: mockE2BCommandsConnect },
    files: {
      getInfo: mockE2BFilesGetInfo,
      read: mockE2BFilesRead,
      remove: mockE2BFilesRemove,
      write: mockE2BFilesWrite,
      list: mockE2BFilesList,
    },
    kill: mockE2BKill,
  })
  mockE2BCommandsRun.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
  mockE2BCommandsConnect.mockResolvedValue({
    wait: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  })
  mockE2BFilesRemove.mockResolvedValue(undefined)
  mockE2BKill.mockResolvedValue(undefined)

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
      sendSessionCommandInput: mockSendSessionCommandInput,
      deleteSession: mockDeleteSession,
    },
    fs: {
      createFolder: mockCreateFolder,
      deleteFile: mockDeleteFile,
      uploadFile: mockUploadFile,
      downloadFile: mockDownloadFile,
      downloadFileStream: mockDownloadFileStream,
      getFileDetails: mockGetFileDetails,
      listFiles: mockListFiles,
    },
    delete: mockDelete,
  })
  mockExecuteCommand.mockResolvedValue({ result: '', exitCode: 0 })
  mockCreateFolder.mockResolvedValue(undefined)
  mockDeleteFile.mockResolvedValue(undefined)
  mockCreateSession.mockResolvedValue(undefined)
  mockGetSessionCommandLogs.mockResolvedValue(undefined)
  mockDelete.mockResolvedValue(undefined)
  mockResolveSandbox.mockResolvedValue(null)
  mockProvisionRuntime.mockResolvedValue(undefined)
  mockExecuteSessionCommand.mockResolvedValue({ cmdId: 'cmd_1' })
  mockGetSessionCommand.mockResolvedValue({ exitCode: 0 })
  mockSendSessionCommandInput.mockResolvedValue(undefined)
})

/** Headroom for the note `tailStreamedSandboxOutput` prepends when it truncates. */
const TRUNCATION_NOTE_ALLOWANCE_BYTES = 256

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

  it('terminates code execution when streamed process output exceeds the byte budget', async () => {
    const oversized = 'x'.repeat(MAX_SANDBOX_PROCESS_OUTPUT_BYTES + 1)
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockImplementationOnce(async (_code, options) => {
        options.onStdout(oversized)
      })
    } else {
      mockGetSessionCommandLogs.mockImplementationOnce(async (_sessionId, _commandId, onStdout) => {
        emitDaytonaStreamReady(onStdout)
        onStdout(oversized)
      })
    }

    await expect(
      executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 1000 })
    ).rejects.toMatchObject({
      code: 'sandbox_output_limit_exceeded',
      outputKind: 'process',
      limitBytes: MAX_SANDBOX_PROCESS_OUTPUT_BYTES,
    })
    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
  })

  it('keeps only a diagnostic tail from a caller-consumed stream', async () => {
    const streamedOutput = 'x'.repeat(MAX_SANDBOX_STREAMED_OUTPUT_TAIL_BYTES + 1024)
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockImplementationOnce(async (_cmd, options) => {
        options.onStdout(`${streamedOutput}TAIL_MARKER`)
        return { stdout: `${streamedOutput}TAIL_MARKER`, stderr: '', exitCode: 0 }
      })
    } else {
      mockGetSessionCommandLogs.mockImplementationOnce(
        async (_sessionId: string, _commandId: string, onStdout: (chunk: string) => void) => {
          onStdout(`${streamedOutput}TAIL_MARKER`)
        }
      )
      mockGetSessionCommand.mockResolvedValue({ exitCode: 0 })
    }

    let streamedBytes = 0
    const result = await withPiSandbox({}, (runner) =>
      runner.run('pi run', {
        timeoutMs: 1000,
        onStdout: (chunk) => {
          streamedBytes += chunk.length
        },
      })
    )

    // Delivered in full to the caller...
    expect(streamedBytes).toBeGreaterThan(MAX_SANDBOX_STREAMED_OUTPUT_TAIL_BYTES)
    expect(result.exitCode).toBe(0)
    /** Only a small diagnostic tail is returned after the caller consumes the full live stream. */
    expect(result.stdout).toContain('TAIL_MARKER')
    // The tail plus its truncation note, NOT a multiple of it. A looser bound here passes on both
    // providers even when one returns twice as much as the other, which is the divergence this
    // pair exists to prevent.
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(
      MAX_SANDBOX_STREAMED_OUTPUT_TAIL_BYTES + TRUNCATION_NOTE_ALLOWANCE_BYTES
    )
  })

  it('cuts the retained tail identically when a stream ends between one and two tails', async () => {
    // The Daytona appender only collapses once the accumulator passes twice the tail, so a stream
    // finishing inside that band is the case where the two providers can disagree.
    const midBand = 'y'.repeat(Math.floor(MAX_SANDBOX_STREAMED_OUTPUT_TAIL_BYTES * 1.5))
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockImplementationOnce(async (_cmd, options) => {
        options.onStdout?.(midBand)
        return { stdout: midBand, stderr: '', exitCode: 0 }
      })
    } else {
      mockGetSessionCommandLogs.mockImplementationOnce(
        async (_sessionId: string, _commandId: string, onStdout: (chunk: string) => void) => {
          onStdout(midBand)
        }
      )
      mockGetSessionCommand.mockResolvedValue({ exitCode: 0 })
    }

    const result = await withPiSandbox({}, (runner) =>
      runner.run('pi run', { timeoutMs: 1000, onStdout: () => {} })
    )

    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(
      MAX_SANDBOX_STREAMED_OUTPUT_TAIL_BYTES + TRUNCATION_NOTE_ALLOWANCE_BYTES
    )
    expect(Buffer.byteLength(result.stdout)).toBeLessThan(Buffer.byteLength(midBand))
  })

  it('still bounds a stream the caller does not consume', async () => {
    const oversized = 'x'.repeat(MAX_SANDBOX_PROCESS_OUTPUT_BYTES + 1)
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockImplementationOnce(async (_cmd, options) => {
        options.onStderr(oversized)
      })
    } else {
      mockGetSessionCommandLogs.mockImplementationOnce(
        async (
          _sessionId: string,
          _commandId: string,
          _onStdout: (chunk: string) => void,
          onStderr: (chunk: string) => void
        ) => {
          onStderr(oversized)
        }
      )
    }

    /** A stdout callback must not exempt unconsumed stderr from the process-output budget. */
    await expect(
      withPiSandbox({}, (runner) => runner.run('pi run', { timeoutMs: 1000, onStdout: () => {} }))
    ).rejects.toMatchObject({ code: 'sandbox_output_limit_exceeded', outputKind: 'process' })
  })

  it('normalizes execution errors to the same shape', async () => {
    stubShellCommand(provider, '', 'Traceback...\nValueError: boom', 1)

    const res = await executeInSandbox({
      code: 'raise ValueError("boom")',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect(res.error).toBe('ValueError: boom')
    expect(res.stdout).toContain('ValueError: boom')
    expect(res.result).toBeNull()
  })

  it('normalizes Python code budget expiry to a typed timeout abort', async () => {
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockRejectedValueOnce(providerTimeoutError(provider))
    } else {
      mockGetSessionCommandLogs.mockRejectedValueOnce(providerTimeoutError(provider))
    }

    await expect(
      executeInSandbox({ code: 'sleep()', language: CodeLanguage.Python, timeoutMs: 1000 })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'timeout' })
  })

  it('normalizes JavaScript code budget expiry to a typed timeout abort', async () => {
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockRejectedValueOnce(providerTimeoutError(provider))
    } else {
      mockGetSessionCommandLogs.mockRejectedValueOnce(providerTimeoutError(provider))
    }

    await expect(
      executeInSandbox({
        code: 'await new Promise(() => {})',
        language: CodeLanguage.JavaScript,
        timeoutMs: 1000,
      })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'timeout' })
  })

  it('preserves request cancellation when sandbox teardown rejects code execution', async () => {
    const controller = new AbortController()
    const rejectAfterCancellation = async () => {
      controller.abort(new DOMException('user', 'AbortError'))
      throw new Error('sandbox deleted')
    }
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockImplementationOnce(rejectAfterCancellation)
    } else {
      mockGetSessionCommandLogs.mockImplementationOnce(rejectAfterCancellation)
    }

    await expect(
      executeInSandbox({
        code: 'sleep()',
        language: CodeLanguage.Python,
        timeoutMs: 10_000,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'user' })
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
      provider === 'e2b'
        ? mockE2BCommandsRun.mock.calls[0]
        : [mockExecuteSessionCommand.mock.calls[0][1].command, undefined]
    expect(command).toContain('curl')
    // The presigned URL must travel as an env var, never interpolated into the shell.
    expect(command).not.toContain('presigned')
    if (provider === 'e2b') {
      expect(options.envs).toMatchObject({
        URL: 'https://example/presigned?x=1',
        DST: '/mnt/data/in.csv',
      })
    } else {
      const envFile = mockUploadFile.mock.calls[0][0].toString('utf8')
      expect(envFile).toContain("URL='https://example/presigned?x=1'")
      expect(envFile).toContain("DST='/mnt/data/in.csv'")
    }
  })

  it('throws rather than running user code against a missing mount', async () => {
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockRejectedValue(new Error('curl: (22) 404'))
    } else {
      stubShellCommand(provider, '', 'curl: (22) 404', 22)
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

  /** Stubs one directory listing in whichever shape the provider returns. */
  function stubOutputDirListing(
    entries: Array<{ path: string; size: number; kind?: 'file' | 'dir' }>
  ) {
    if (provider === 'e2b') {
      mockE2BFilesList.mockResolvedValueOnce(
        entries.map((entry) => ({
          name: entry.path.split('/').pop(),
          path: entry.path,
          size: entry.size,
          type: entry.kind === 'dir' ? 'dir' : 'file',
        }))
      )
    } else {
      mockListFiles.mockResolvedValueOnce(
        entries.map((entry) => ({
          name: entry.path.split('/').pop(),
          path: entry.path,
          size: entry.size,
          isDir: entry.kind === 'dir',
          mode: entry.kind === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--',
        }))
      )
    }
  }

  it('creates the output directory before user code runs', async () => {
    stubCodeRun(provider, `__SIM_RESULT__=${JSON.stringify('done')}`)
    stubOutputDirListing([])

    await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
      outputSandboxDir: '/tmp/sim/outputs',
    })

    // Regression guard. `outputSandboxDir` is this layer's contract, so this
    // layer has to create the directory: when creation lived in the caller's
    // runtime prologue instead, calling executeInSandbox directly left user
    // code writing into a directory that did not exist, and every write was
    // ENOENT. The sentinel must be written before the code file that runs.
    const writeMock = provider === 'e2b' ? mockE2BFilesWrite : mockUploadFile
    const writtenPaths = writeMock.mock.calls.map((call) =>
      provider === 'e2b' ? call[0] : call[1]
    )
    const sentinelIndex = writtenPaths.findIndex((path: string) =>
      path?.includes('/tmp/sim/outputs/.sim-keep')
    )
    const codeIndex = writtenPaths.findIndex((path: string) => path?.includes('.sim-function-'))
    expect(sentinelIndex).toBeGreaterThanOrEqual(0)
    expect(codeIndex).toBeGreaterThanOrEqual(0)
    expect(sentinelIndex).toBeLessThan(codeIndex)
  })

  it('keeps the directory sentinel out of the harvest', async () => {
    stubCodeRun(provider, `__SIM_RESULT__=${JSON.stringify('done')}`)
    stubOutputDirListing([
      { path: `/tmp/sim/outputs/${SANDBOX_OUTPUT_DIR_SENTINEL}`, size: 0 },
      { path: '/tmp/sim/outputs/real.txt', size: 4 },
    ])
    stubOutputFileSizes(provider, 4)
    stubOutputFileRead(provider, 'real')

    const result = await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
      outputSandboxDir: '/tmp/sim/outputs',
    })

    expect(result.collectedFiles?.map((file) => file.relativePath)).toEqual(['real.txt'])
  })

  it('harvests files written to the output directory', async () => {
    stubCodeRun(provider, `__SIM_RESULT__=${JSON.stringify('done')}`)
    stubOutputDirListing([{ path: '/tmp/sim/outputs/report.csv', size: 5 }])
    stubOutputFileSizes(provider, 5)
    stubOutputFileRead(provider, 'a,b\n1')

    const result = await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
      outputSandboxDir: '/tmp/sim/outputs',
    })

    expect(result.collectedFiles).toEqual([
      {
        path: '/tmp/sim/outputs/report.csv',
        relativePath: 'report.csv',
        // Always base64, so an arbitrary harvested filename can never be
        // decoded as utf8 and silently corrupted.
        contentBase64: Buffer.from('a,b\n1').toString('base64'),
        byteLength: 5,
      },
    ])
  })

  it('excludes directories from the harvest', async () => {
    stubCodeRun(provider, `__SIM_RESULT__=${JSON.stringify('done')}`)
    stubOutputDirListing([{ path: '/tmp/sim/outputs/nested', size: 0, kind: 'dir' }])

    const result = await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
      outputSandboxDir: '/tmp/sim/outputs',
    })

    expect(result.collectedFiles).toBeUndefined()
  })

  it('refuses a harvest whose nesting outran the listing depth', async () => {
    stubCodeRun(provider, `__SIM_RESULT__=${JSON.stringify('done')}`)
    // A directory reported at the traversal limit still holds unlisted files.
    // Returning the shallow ones would drop the rest without a word.
    const deep = Array.from({ length: 12 }, (_, index) => `l${index + 1}`).join('/')
    stubOutputDirListing([
      { path: '/tmp/sim/outputs/shallow.txt', size: 4 },
      { path: `/tmp/sim/outputs/${deep}`, size: 0, kind: 'dir' },
    ])

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 1000,
        outputSandboxDir: '/tmp/sim/outputs',
      })
    ).rejects.toThrow(/nested deeper than 12 levels/)
  })

  it('refuses a harvest over the output file count rather than truncating it', async () => {
    stubCodeRun(provider, `__SIM_RESULT__=${JSON.stringify('done')}`)
    stubOutputDirListing(
      Array.from({ length: 21 }, (_, index) => ({
        path: `/tmp/sim/outputs/file-${index}.txt`,
        size: 1,
      }))
    )

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 1000,
        outputSandboxDir: '/tmp/sim/outputs',
      })
    ).rejects.toThrow(/over the 20-file export limit/)
  })

  it('does not list the output directory when no harvest was requested', async () => {
    stubCodeRun(provider, `__SIM_RESULT__=${JSON.stringify('done')}`)

    const result = await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    expect(result.collectedFiles).toBeUndefined()
    expect(provider === 'e2b' ? mockE2BFilesList : mockListFiles).not.toHaveBeenCalled()
  })

  it('materializes private code inputs after dependencies and user files', async () => {
    const privateText = 'line one\n"quoted"\\slash\0tail'
    const privateBytes = Uint8Array.from([0, 10, 34, 92, 255]).buffer
    mockResolveSandbox.mockResolvedValue({
      id: 'sbx-private-code',
      name: 'private-code',
      language: CodeLanguage.Python,
      dependencies: ['requests'],
      strategy: 'runtime',
      envs: {
        PRIVATE_TEXT_PATH: 'selected-text-path',
        PRIVATE_BYTES_PATH: 'selected-bytes-path',
        SELECTED_ONLY: 'selected-value',
      },
    })
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)

    await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 60_000,
      sandboxFiles: [{ path: '/mnt/user-input.txt', content: 'user-input' }],
      privateInputs: [
        { environmentVariable: 'PRIVATE_TEXT_PATH', content: privateText },
        { environmentVariable: 'PRIVATE_BYTES_PATH', content: privateBytes },
      ],
    })

    const writes = capturedSandboxWrites(provider)
    const userWrite = writes.find((write) => write.path === '/mnt/user-input.txt')
    const privateWrites = writes.filter((write) =>
      /^\/tmp\/\.sim-private-input-[A-Za-z0-9_-]+-[01]$/.test(write.path)
    )
    const privateTextWrite = privateWrites.find((write) => write.path.endsWith('-0'))
    const privateBytesWrite = privateWrites.find((write) => write.path.endsWith('-1'))
    expect(userWrite).toBeDefined()
    expect(privateWrites).toHaveLength(2)
    expect(privateTextWrite).toBeDefined()
    expect(privateBytesWrite).toBeDefined()
    expect(sandboxWriteBuffer(userWrite?.content).toString()).toBe('user-input')
    expect(privateTextWrite?.path).not.toBe(privateBytesWrite?.path)
    expect(sandboxWriteBuffer(privateTextWrite?.content)).toEqual(Buffer.from(privateText))
    expect(sandboxWriteBuffer(privateBytesWrite?.content)).toEqual(Buffer.from(privateBytes))

    const expectedEnvironment = {
      PRIVATE_TEXT_PATH: privateTextWrite?.path,
      PRIVATE_BYTES_PATH: privateBytesWrite?.path,
      SELECTED_ONLY: 'selected-value',
    }
    let executionOrder: number
    if (provider === 'e2b') {
      const [, runOptions] = mockE2BCommandsRun.mock.calls[0]
      expect(runOptions.envs).toMatchObject(expectedEnvironment)
      expect(JSON.stringify(runOptions.envs)).not.toContain(privateText)
      executionOrder = mockE2BCommandsRun.mock.invocationCallOrder[0]
    } else {
      const environmentWrite = writes.find((write) => write.path.startsWith('/tmp/.sim-env-'))
      expect(environmentWrite).toBeDefined()
      const environmentFile = sandboxWriteBuffer(environmentWrite?.content).toString()
      expect(environmentFile).toContain(`PRIVATE_TEXT_PATH='${privateTextWrite?.path ?? ''}'`)
      expect(environmentFile).toContain(`PRIVATE_BYTES_PATH='${privateBytesWrite?.path ?? ''}'`)
      expect(environmentFile).toContain("SELECTED_ONLY='selected-value'")
      expect(environmentFile).not.toContain(privateText)
      executionOrder = mockExecuteSessionCommand.mock.invocationCallOrder[0]
    }
    expect(mockProvisionRuntime.mock.invocationCallOrder[0]).toBeLessThan(userWrite?.order ?? 0)
    expect(userWrite?.order).toBeLessThan(privateTextWrite?.order ?? 0)
    expect(privateBytesWrite?.order).toBeLessThan(executionOrder)
    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
  })

  it('passes private shell input paths after selected and caller environment values', async () => {
    const privateContent = 'quoted heredoc\nwith \0 and "quotes"'
    mockResolveSandbox.mockResolvedValue({
      id: 'sbx-private-shell',
      name: 'private-shell',
      language: CodeLanguage.Shell,
      dependencies: ['jq'],
      strategy: 'runtime',
      envs: {
        PRIVATE_HEREDOC_PATH: 'selected-path',
        SELECTED_ONLY: 'selected-value',
      },
    })
    stubShellCommand(provider, '', '', 0)

    await executeShellInSandbox({
      code: 'cat "$PRIVATE_HEREDOC_PATH"',
      envs: {
        PRIVATE_HEREDOC_PATH: 'caller-path',
        CALLER_ONLY: 'caller-value',
      },
      timeoutMs: 60_000,
      sandboxFiles: [{ path: '/mnt/shell-user-input.txt', content: 'shell-user-input' }],
      privateInputs: [{ environmentVariable: 'PRIVATE_HEREDOC_PATH', content: privateContent }],
    })

    const writes = capturedSandboxWrites(provider)
    const userWrite = writes.find((write) => write.path === '/mnt/shell-user-input.txt')
    const privateWrite = writes.find((write) =>
      /^\/tmp\/\.sim-private-input-[A-Za-z0-9_-]+-0$/.test(write.path)
    )
    expect(userWrite).toBeDefined()
    expect(privateWrite).toBeDefined()
    expect(sandboxWriteBuffer(userWrite?.content).toString()).toBe('shell-user-input')
    expect(sandboxWriteBuffer(privateWrite?.content)).toEqual(Buffer.from(privateContent))
    expect(mockProvisionRuntime.mock.invocationCallOrder[0]).toBeLessThan(userWrite?.order ?? 0)
    expect(userWrite?.order).toBeLessThan(privateWrite?.order ?? 0)

    if (provider === 'e2b') {
      const [, options] = mockE2BCommandsRun.mock.calls[0]
      expect(options.envs).toMatchObject({
        PRIVATE_HEREDOC_PATH: privateWrite?.path,
        SELECTED_ONLY: 'selected-value',
        CALLER_ONLY: 'caller-value',
      })
      expect(JSON.stringify(options.envs)).not.toContain(privateContent)
      expect(privateWrite?.order).toBeLessThan(mockE2BCommandsRun.mock.invocationCallOrder[0])
    } else {
      const environmentWrite = writes.find((write) => write.path.startsWith('/tmp/.sim-env-'))
      expect(environmentWrite).toBeDefined()
      const environmentFile = sandboxWriteBuffer(environmentWrite?.content).toString()
      expect(environmentFile).toContain(`PRIVATE_HEREDOC_PATH='${privateWrite?.path ?? ''}'`)
      expect(environmentFile).toContain("SELECTED_ONLY='selected-value'")
      expect(environmentFile).toContain("CALLER_ONLY='caller-value'")
      expect(environmentFile).not.toContain(privateContent)
      expect(privateWrite?.order).toBeLessThan(environmentWrite?.order ?? 0)
      expect(environmentWrite?.order).toBeLessThan(
        mockExecuteSessionCommand.mock.invocationCallOrder[0]
      )
    }
    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
  })

  it('tears down without running code when private input materialization is aborted', async () => {
    const controller = new AbortController()
    const abortWrite = async () => {
      controller.abort(new DOMException('private input cancelled', 'AbortError'))
    }
    if (provider === 'e2b') {
      mockE2BFilesWrite.mockImplementationOnce(abortWrite)
    } else {
      mockUploadFile.mockImplementationOnce(abortWrite)
    }

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 10_000,
        signal: controller.signal,
        privateInputs: [{ environmentVariable: 'PRIVATE_INPUT_PATH', content: 'private' }],
      })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'private input cancelled' })

    expect(
      provider === 'e2b' ? mockE2BCommandsRun : mockExecuteSessionCommand
    ).not.toHaveBeenCalled()
    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
  })

  it('tears down without running code when a private input write fails', async () => {
    const writeError = new Error('private input write failed')
    if (provider === 'e2b') {
      mockE2BFilesWrite.mockRejectedValueOnce(writeError)
    } else {
      mockUploadFile.mockRejectedValueOnce(writeError)
    }

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 10_000,
        privateInputs: [{ environmentVariable: 'PRIVATE_INPUT_PATH', content: 'private' }],
      })
    ).rejects.toBe(writeError)

    expect(
      provider === 'e2b' ? mockE2BCommandsRun : mockExecuteSessionCommand
    ).not.toHaveBeenCalled()
    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
  })

  it('treats a non-JSON shell marker as a plain string, not corruption', async () => {
    const stdout = `${SIM_RESULT_PREFIX}PLAIN_STATUS`
    stubShellCommand(provider, stdout, '', 0)

    const res = await executeShellInSandbox({ code: 'echo hi', envs: {}, timeoutMs: 1000 })

    expect(res.result).toBe('PLAIN_STATUS')
    expect(res.error).toBeUndefined()
  })

  it('returns ordinary successful shell output through stdout', async () => {
    const stdout = 'Client Version: v1.36.3\nKustomize Version: v5.7.1'
    stubShellCommand(provider, stdout, '', 0)

    const res = await executeShellInSandbox({
      code: 'kubectl version --client',
      envs: {},
      timeoutMs: 1000,
    })

    expect(res.result).toBeNull()
    expect(res.stdout).toBe(stdout)
    expect(res.error).toBeUndefined()
  })

  it('surfaces the real command output as the error, not a generic message', async () => {
    /**
     * E2B populates stderr. Daytona merges both streams into stdout, so failures
     * must fall back to stdout instead of displaying only a generic exit code.
     */
    stubShellCommand(provider, provider === 'daytona' ? 'boom detail' : '', 'boom detail', 3)

    const res = await executeShellInSandbox({ code: 'false', envs: {}, timeoutMs: 1000 })

    expect(res.result).toBeNull()
    expect(res.error).toContain('boom detail')
    expect(res.stdout).toContain('boom detail')
  })

  it('terminates shell execution when streamed process output exceeds the byte budget', async () => {
    const oversized = 'x'.repeat(MAX_SANDBOX_PROCESS_OUTPUT_BYTES + 1)
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockImplementationOnce(async (_command, options) => {
        options.onStdout(oversized)
      })
    } else {
      mockGetSessionCommandLogs.mockImplementationOnce(async (_sessionId, _commandId, onStdout) => {
        emitDaytonaStreamReady(onStdout)
        onStdout(oversized)
      })
    }

    await expect(
      executeShellInSandbox({ code: 'echo forever', timeoutMs: 1000 })
    ).rejects.toMatchObject({
      code: 'sandbox_output_limit_exceeded',
      outputKind: 'process',
      limitBytes: MAX_SANDBOX_PROCESS_OUTPUT_BYTES,
    })
    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
  })

  it('normalizes shell command budget expiry to a typed timeout abort', async () => {
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockRejectedValueOnce(providerTimeoutError(provider))
    } else {
      mockGetSessionCommandLogs.mockRejectedValueOnce(providerTimeoutError(provider))
    }

    await expect(
      executeShellInSandbox({ code: 'sleep infinity', timeoutMs: 1000 })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'timeout' })
  })

  it('preserves a user process exit code 124 as an ordinary failure', async () => {
    stubShellCommand(provider, 'user selected exit 124', '', 124)

    const result = await executeShellInSandbox({
      code: 'exit 124',
      timeoutMs: 10_000,
    })

    expect(result.error).toContain('user selected exit 124')
    expect(result.stdout).toContain('user selected exit 124')
  })

  it('preserves code-runner exit 124 as an ordinary execution error', async () => {
    stubShellCommand(provider, '', 'IntentionalError: user exit 124', 124)

    const result = await executeInSandbox({
      code: 'raise SystemExit(124)',
      language: CodeLanguage.Python,
      timeoutMs: 10_000,
    })

    expect(result.error).toBe('IntentionalError: user exit 124')
    expect(result.stdout).toContain('IntentionalError: user exit 124')
  })

  it('classifies an abort observed after a shell command instead of returning a provider error', async () => {
    const controller = new AbortController()
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockImplementationOnce(async () => {
        controller.abort(new DOMException('user', 'AbortError'))
        throw providerTimeoutError(provider)
      })
    } else {
      mockGetSessionCommandLogs.mockImplementationOnce(async () => {
        controller.abort(new DOMException('user', 'AbortError'))
      })
      mockGetSessionCommand.mockResolvedValueOnce({ exitCode: 124 })
    }

    await expect(
      executeShellInSandbox({ code: 'sleep 10', timeoutMs: 10_000, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'user' })
  })

  it('exports binary output files as base64', async () => {
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
    stubOutputFileSizes(provider, 6, 6)
    stubOutputFileRead(provider, 'BASE64')

    const res = await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
      outputSandboxPath: '/out/report.xlsx',
    })

    expect(res.exportedFileContent).toBe('QkFTRTY0')
    expect(res.exportedFiles).toEqual({ '/out/report.xlsx': 'QkFTRTY0' })
  })

  it('rejects an oversized output before reading provider file bytes', async () => {
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
    stubOutputFileSizes(provider, MAX_SANDBOX_OUTPUT_BYTES + 1)

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 1000,
        outputSandboxPath: '/out/report.txt',
      })
    ).rejects.toMatchObject({
      code: 'sandbox_output_limit_exceeded',
      attemptedBytes: MAX_SANDBOX_OUTPUT_BYTES + 1,
      limitBytes: MAX_SANDBOX_OUTPUT_BYTES,
    })

    expect(provider === 'e2b' ? mockE2BFilesRead : mockDownloadFileStream).not.toHaveBeenCalled()
  })

  it('rejects cumulative output size before reading any provider file bytes', async () => {
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
    const fileSize = MAX_SANDBOX_OUTPUT_BYTES / 2 + 1
    stubOutputFileSizes(provider, fileSize, fileSize)

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 1000,
        outputSandboxPaths: ['/out/first.txt', '/out/second.txt'],
      })
    ).rejects.toMatchObject({
      code: 'sandbox_output_limit_exceeded',
      attemptedBytes: fileSize * 2,
      limitBytes: MAX_SANDBOX_OUTPUT_BYTES,
    })

    expect(provider === 'e2b' ? mockE2BFilesRead : mockDownloadFileStream).not.toHaveBeenCalled()
  })

  it('enforces the file limit while reading when a file grows after inspection', async () => {
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
    stubOutputFileSizes(provider, 1, 1)
    stubOutputFileRead(provider, Buffer.alloc(MAX_SANDBOX_OUTPUT_BYTES + 1, 97))

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 1000,
        outputSandboxPath: '/out/growing.txt',
      })
    ).rejects.toMatchObject({
      code: 'sandbox_output_limit_exceeded',
      attemptedBytes: MAX_SANDBOX_OUTPUT_BYTES + 1,
      limitBytes: MAX_SANDBOX_OUTPUT_BYTES,
    })
  })

  it('rejects symlinks and other non-regular output paths', async () => {
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
    if (provider === 'e2b') {
      mockE2BFilesGetInfo.mockResolvedValueOnce({ size: 1, type: 'symlink' })
    } else {
      mockGetFileDetails.mockResolvedValueOnce({ size: 1, isDir: false, mode: 'prw-r--r--' })
    }

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 1000,
        outputSandboxPath: '/out/link.txt',
      })
    ).rejects.toMatchObject({ code: 'sandbox_output_file_invalid' })
    expect(provider === 'e2b' ? mockE2BFilesRead : mockDownloadFileStream).not.toHaveBeenCalled()
  })

  it('does not return code results when cancellation arrives during output collection', async () => {
    const controller = new AbortController()
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
    stubOutputFileSizes(provider, 6, 6)
    stubOutputFileRead(provider, 'report', () => {
      controller.abort(new DOMException('user', 'AbortError'))
    })

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 1000,
        outputSandboxPath: '/out/report.txt',
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'user' })
  })

  it('does not return shell results when cancellation arrives during output collection', async () => {
    const controller = new AbortController()
    stubShellCommand(provider, '', '', 0)
    stubOutputFileSizes(provider, 6, 6)
    stubOutputFileRead(provider, 'report', () => {
      controller.abort(new DOMException('user', 'AbortError'))
    })

    await expect(
      executeShellInSandbox({
        code: 'true',
        timeoutMs: 1000,
        outputSandboxPath: '/out/report.txt',
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'user' })
  })

  it('enforces the wall-clock budget while creating the sandbox', async () => {
    let resolveCreate!: (value: unknown) => void
    const stalledCreate = new Promise<unknown>((resolve) => {
      resolveCreate = resolve
    })
    if (provider === 'e2b') mockE2BCreate.mockReturnValueOnce(stalledCreate)
    else mockDaytonaCreate.mockReturnValueOnce(stalledCreate)

    await expect(
      executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 25 })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'timeout' })

    resolveCreate(
      provider === 'e2b'
        ? {
            sandboxId: 'late-sandbox',
            commands: { run: mockE2BCommandsRun },
            files: {
              getInfo: mockE2BFilesGetInfo,
              read: mockE2BFilesRead,
              remove: mockE2BFilesRemove,
              write: mockE2BFilesWrite,
            },
            kill: mockE2BKill,
          }
        : {
            id: 'late-sandbox',
            process: {
              createSession: mockCreateSession,
              executeSessionCommand: mockExecuteSessionCommand,
              getSessionCommandLogs: mockGetSessionCommandLogs,
              getSessionCommand: mockGetSessionCommand,
              deleteSession: mockDeleteSession,
            },
            fs: {
              deleteFile: mockDeleteFile,
              uploadFile: mockUploadFile,
              downloadFileStream: mockDownloadFileStream,
              getFileDetails: mockGetFileDetails,
            },
            delete: mockDelete,
          }
    )
    await vi.waitFor(() => {
      expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
    })
  })

  it('enforces the wall-clock budget while materializing mounted files', async () => {
    const stalledWrite = () => new Promise<void>(() => {})
    if (provider === 'e2b') mockE2BFilesWrite.mockImplementationOnce(stalledWrite)
    else mockUploadFile.mockImplementationOnce(stalledWrite)

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 25,
        sandboxFiles: [{ path: '/mnt/input.txt', content: 'input' }],
      })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'timeout' })
    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
  })

  it('enforces the wall-clock budget while writing provider runtime files', async () => {
    const stalledWrite = () => new Promise<void>(() => {})
    if (provider === 'e2b') mockE2BFilesWrite.mockImplementationOnce(stalledWrite)
    else mockUploadFile.mockImplementationOnce(stalledWrite)

    await expect(
      executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 25 })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'timeout' })
    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
  })

  it('enforces the wall-clock budget while provisioning dependencies', async () => {
    mockResolveSandbox.mockResolvedValue({
      id: 'sbx-budget',
      name: 'budget',
      language: CodeLanguage.Python,
      dependencies: ['requests'],
      strategy: 'runtime',
    })
    mockProvisionRuntime.mockImplementationOnce(() => new Promise<void>(() => {}))

    await expect(
      executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 25 })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'timeout' })
    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
  })

  it('enforces the wall-clock budget while collecting output files', async () => {
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
    const stalledInspection = () => new Promise<unknown>(() => {})
    if (provider === 'e2b') mockE2BFilesGetInfo.mockImplementationOnce(stalledInspection)
    else mockGetFileDetails.mockImplementationOnce(stalledInspection)

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 25,
        outputSandboxPath: '/out/report.txt',
      })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'timeout' })
    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
  })

  it('always kills the sandbox, even when execution throws', async () => {
    if (provider === 'e2b') {
      mockE2BCommandsRun.mockRejectedValue(new Error('kaboom'))
    } else {
      mockGetSessionCommandLogs.mockRejectedValue(new Error('kaboom'))
    }

    await expect(
      executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 1000 })
    ).rejects.toThrow('kaboom')

    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(1)
  })

  it('records a bounded metric when best-effort teardown fails', async () => {
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
    if (provider === 'e2b') {
      mockE2BKill.mockRejectedValueOnce(new Error('kill failed'))
    } else {
      mockDelete.mockRejectedValueOnce(new Error('delete failed'))
    }

    await executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 1000 })

    expect(mockRecordSandboxTeardownFailure).toHaveBeenCalledWith({
      provider,
      reason: 'cleanup',
    })
    expect(provider === 'e2b' ? mockE2BKill : mockDelete).toHaveBeenCalledTimes(2)
  })
})

describe('E2B streamed output safety', () => {
  it('bounds callback-delivered output that the E2B SDK also retains', async () => {
    useProvider('e2b')
    mockE2BCommandsRun.mockImplementationOnce(async (_command, options) => {
      options.onStdout?.('1234')
      options.onStdout?.('56789')
      return { stdout: '123456789', stderr: '', exitCode: 0 }
    })

    const streamed: string[] = []
    const sandbox = await e2bProvider.create('pi')

    await expect(
      sandbox.runCommand('pi run', {
        timeoutMs: 1000,
        maxOutputBytes: 8,
        onStdout: (chunk) => streamed.push(chunk),
      })
    ).rejects.toMatchObject({
      code: 'sandbox_output_limit_exceeded',
      outputKind: 'process',
      attemptedBytes: 9,
      limitBytes: 8,
    })
    expect(streamed).toEqual(['1234'])
    expect(mockE2BKill).toHaveBeenCalledTimes(1)
  })
})

describe('provider stream recovery', () => {
  it('fails an at-most-once E2B run closed when its output stream disconnects', async () => {
    const wait = vi.fn().mockRejectedValueOnce(new Error('stream disconnected'))
    mockE2BCommandsRun.mockResolvedValueOnce({ pid: 42, wait })
    const sandbox = await e2bProvider.create('code')

    await expect(
      sandbox.runCommand('node function.js', { timeoutMs: 1000, atMostOnce: true })
    ).rejects.toMatchObject({
      name: 'SandboxLaunchIndeterminateError',
      retryable: false,
      code: 'sandbox_launch_indeterminate',
    })

    expect(mockE2BCommandsRun).toHaveBeenCalledTimes(1)
    expect(mockE2BCommandsConnect).not.toHaveBeenCalled()
  })

  it('forwards E2B output received after reconnecting to the exact process', async () => {
    const wait = vi.fn().mockRejectedValueOnce(new Error('stream disconnected'))
    mockE2BCommandsRun.mockImplementationOnce(async (_command, options) => {
      options.onStdout?.('before')
      return { pid: 42, wait }
    })
    mockE2BCommandsConnect.mockImplementationOnce(async (_pid, options) => {
      options.onStdout?.('after')
      options.onStderr?.('warning')
      return {
        wait: vi.fn().mockResolvedValue({ stdout: 'after', stderr: 'warning', exitCode: 0 }),
      }
    })
    const sandbox = await e2bProvider.create('code')
    const stdout: string[] = []
    const stderr: string[] = []

    await expect(
      sandbox.runCommand('node function.js', {
        timeoutMs: 1000,
        onStdout: (chunk) => stdout.push(chunk),
        onStderr: (chunk) => stderr.push(chunk),
      })
    ).resolves.toMatchObject({ stdout: 'beforeafter', stderr: 'warning', exitCode: 0 })

    expect(stdout).toEqual(['before', 'after'])
    expect(stderr).toEqual(['warning'])
    expect(mockE2BCommandsRun).toHaveBeenCalledTimes(1)
    expect(mockE2BCommandsConnect).toHaveBeenCalledWith(42, expect.any(Object))
  })

  it('bounds E2B output received while reconnecting to the exact process', async () => {
    const wait = vi.fn().mockRejectedValueOnce(new Error('stream disconnected'))
    mockE2BCommandsRun.mockResolvedValueOnce({ pid: 42, wait })
    mockE2BCommandsConnect.mockImplementationOnce(async (_pid, options) => {
      options.onStdout?.('12345')
      return { wait: vi.fn() }
    })
    const sandbox = await e2bProvider.create('code')

    await expect(
      sandbox.runCommand('pi run', {
        timeoutMs: 1000,
        maxOutputBytes: 4,
      })
    ).rejects.toMatchObject({
      code: 'sandbox_output_limit_exceeded',
      attemptedBytes: 5,
      limitBytes: 4,
    })
    expect(mockE2BCommandsRun).toHaveBeenCalledTimes(1)
    expect(mockE2BCommandsConnect).toHaveBeenCalledTimes(1)
  })

  it('marks an ambiguous E2B start as indeterminate without retrying', async () => {
    mockE2BCommandsRun.mockRejectedValueOnce(new Error('connection reset during start'))
    const sandbox = await e2bProvider.create('code')

    await expect(
      sandbox.runCommand('node function.js', { timeoutMs: 1000, atMostOnce: true })
    ).rejects.toMatchObject({
      name: 'SandboxLaunchIndeterminateError',
      retryable: false,
      code: 'sandbox_launch_indeterminate',
    })
    expect(mockE2BCommandsRun).toHaveBeenCalledTimes(1)
    expect(mockE2BCommandsConnect).not.toHaveBeenCalled()
  })

  it('reattaches to the exact Daytona session command after a stream disconnect', async () => {
    mockGetSessionCommandLogs
      .mockRejectedValueOnce(new Error('stream disconnected'))
      .mockImplementationOnce(
        async (_sessionId: string, _commandId: string, onStdout: (chunk: string) => void) => {
          onStdout('__SIM_DAYTONA_STREAM_READY__\ndone')
        }
      )
    const sandbox = await daytonaProvider.create('code')

    await expect(
      sandbox.runCommand('node function.js', { timeoutMs: 1000, atMostOnce: true })
    ).resolves.toMatchObject({ stdout: 'done', exitCode: 0 })

    expect(mockExecuteSessionCommand).toHaveBeenCalledTimes(1)
    expect(mockExecuteSessionCommand.mock.calls[0]?.[1]).toMatchObject({
      runAsync: true,
      suppressInputEcho: true,
    })
    expect(mockGetSessionCommandLogs).toHaveBeenCalledTimes(2)
    expect(mockGetSessionCommand).toHaveBeenCalledWith(expect.any(String), 'cmd_1')
  })

  it('keeps the original Daytona deadline while recovering a disconnected stream', async () => {
    mockGetSessionCommandLogs
      .mockRejectedValueOnce(new Error('stream disconnected'))
      .mockImplementationOnce(() => new Promise<void>(() => {}))
    const sandbox = await daytonaProvider.create('code')

    await expect(
      sandbox.runCommand('node function.js', { timeoutMs: 25, atMostOnce: true })
    ).resolves.toMatchObject({ exitCode: 124, timedOut: true })

    expect(mockExecuteSessionCommand).toHaveBeenCalledTimes(1)
    expect(mockGetSessionCommandLogs).toHaveBeenCalledTimes(2)
    expect(mockGetSessionCommand).not.toHaveBeenCalled()
    expect(mockDeleteSession).toHaveBeenCalledTimes(1)
  })

  it('preserves a legitimate leading newline in Daytona stdout', async () => {
    mockGetSessionCommandLogs.mockImplementationOnce(
      async (_sessionId: string, _commandId: string, onStdout: (chunk: string) => void) => {
        onStdout('__SIM_DAYTONA_STREAM_READY__\n')
        onStdout('\nhello')
      }
    )
    const sandbox = await daytonaProvider.create('code')

    await expect(
      sandbox.runCommand('printf "\\nhello"', { timeoutMs: 1000, atMostOnce: true })
    ).resolves.toMatchObject({ stdout: '\nhello', exitCode: 0 })
  })

  it('bounds Daytona output replayed while reconnecting to the exact command', async () => {
    mockGetSessionCommandLogs
      .mockRejectedValueOnce(new Error('stream disconnected'))
      .mockImplementationOnce(
        async (_sessionId: string, _commandId: string, onStdout: (chunk: string) => void) => {
          onStdout('__SIM_DAYTONA_STREAM_READY__\n12345')
        }
      )
    const sandbox = await daytonaProvider.create('code')

    await expect(
      sandbox.runCommand('node function.js', {
        timeoutMs: 1000,
        maxOutputBytes: 4,
        atMostOnce: true,
      })
    ).rejects.toMatchObject({
      code: 'sandbox_output_limit_exceeded',
      attemptedBytes: 5,
      limitBytes: 4,
    })
    expect(mockExecuteSessionCommand).toHaveBeenCalledTimes(1)
    expect(mockGetSessionCommandLogs).toHaveBeenCalledTimes(2)
  })

  it('does not redeliver callback-consumed Daytona output beyond the retained diagnostic tail', async () => {
    const beforeDisconnect = 'x'.repeat(MAX_SANDBOX_STREAMED_OUTPUT_TAIL_BYTES * 2)
    mockGetSessionCommandLogs
      .mockImplementationOnce(
        async (_sessionId: string, _commandId: string, onStdout: (chunk: string) => void) => {
          onStdout('__SIM_DAYTONA_STREAM_READY__\n')
          onStdout(beforeDisconnect)
          throw new Error('stream disconnected')
        }
      )
      .mockImplementationOnce(
        async (_sessionId: string, _commandId: string, onStdout: (chunk: string) => void) => {
          onStdout(`__SIM_DAYTONA_STREAM_READY__\n${beforeDisconnect}after`)
        }
      )
    const sandbox = await daytonaProvider.create('code')
    const stdout: string[] = []

    await expect(
      sandbox.runCommand('node function.js', {
        timeoutMs: 1000,
        atMostOnce: true,
        onStdout: (chunk) => stdout.push(chunk),
      })
    ).resolves.toMatchObject({ stdout: expect.stringContaining('after'), exitCode: 0 })

    expect(stdout.join('')).toBe(`${beforeDisconnect}after`)
    expect(mockExecuteSessionCommand).toHaveBeenCalledTimes(1)
    expect(mockGetSessionCommandLogs).toHaveBeenCalledTimes(2)
  })

  it.each([{}, null, undefined])(
    'marks a Daytona start without a command identity as indeterminate',
    async (started) => {
      mockExecuteSessionCommand.mockResolvedValueOnce(started)
      const sandbox = await daytonaProvider.create('code')

      await expect(
        sandbox.runCommand('node function.js', { timeoutMs: 1000, atMostOnce: true })
      ).rejects.toMatchObject({
        name: 'SandboxLaunchIndeterminateError',
        retryable: false,
        code: 'sandbox_launch_indeterminate',
      })
      expect(mockExecuteSessionCommand).toHaveBeenCalledTimes(1)
    }
  )
})

describe('custom dependency sets', () => {
  it.each(PROVIDERS)('honors imageRef for code executions [%s]', async (provider) => {
    useProvider(provider)
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
    mockResolveSandbox.mockResolvedValue({
      id: 'sbx-1',
      name: 'etl',
      language: CodeLanguage.Python,
      dependencies: ['pandas'],
      strategy: 'prebuilt',
      imageRef: 'sim-sbx-abc',
    })

    await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })

    if (provider === 'e2b') {
      expect(mockE2BCreate).toHaveBeenCalledWith('sim-sbx-abc', expect.anything())
    } else {
      expect(mockDaytonaCreate).toHaveBeenCalledWith(
        expect.objectContaining({ snapshot: 'sim-sbx-abc' })
      )
    }
  })

  it.each(PROVIDERS)('refuses to let a sandbox displace the doc image [%s]', async (provider) => {
    useProvider(provider)
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
    // Even if resolution somehow yields a ref, the provider gates on the kind.
    mockResolveSandbox.mockResolvedValue({
      id: 'sbx-1',
      name: 'etl',
      language: CodeLanguage.Python,
      dependencies: ['pandas'],
      strategy: 'prebuilt',
      imageRef: 'sim-sbx-abc',
    })

    await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
      sandboxKind: 'doc',
      workspaceId: 'ws-1',
      sandboxId: 'sbx-1',
    })

    if (provider === 'e2b') {
      expect(mockE2BCreate).toHaveBeenCalledWith('mothership-docs', expect.anything())
    } else {
      expect(mockDaytonaCreate).toHaveBeenCalledWith(
        expect.objectContaining({ snapshot: 'mothership-docs:v1' })
      )
    }
  })

  it.each(PROVIDERS)(
    'spends the runtime install out of the caller budget, not on top of it [%s]',
    async (provider) => {
      useProvider(provider)
      stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
      mockResolveSandbox.mockResolvedValue({
        id: 'sbx-1',
        name: 'etl',
        language: CodeLanguage.Python,
        dependencies: ['pandas'],
        strategy: 'runtime',
      })

      // Well under the 240s ceiling, so the caller's budget is what binds.
      await executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 60_000,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })

      // 60s budget minus the 15s reserved for the code itself.
      expect(mockProvisionRuntime).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ timeoutMs: expect.any(Number) })
      )
      const runtimeOptions = mockProvisionRuntime.mock.calls.at(-1)?.[2] as
        | { timeoutMs: number }
        | undefined
      expect(runtimeOptions?.timeoutMs).toBeGreaterThan(44_000)
      expect(runtimeOptions?.timeoutMs).toBeLessThanOrEqual(45_000)
    }
  )

  it.each(PROVIDERS)(
    'caps the install at its own ceiling when the budget is generous [%s]',
    async (provider) => {
      useProvider(provider)
      stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)
      mockResolveSandbox.mockResolvedValue({
        id: 'sbx-1',
        name: 'etl',
        language: CodeLanguage.Python,
        dependencies: ['pandas'],
        strategy: 'runtime',
      })

      await executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 900_000,
        workspaceId: 'ws-1',
        sandboxId: 'sbx-1',
      })

      expect(mockProvisionRuntime).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ timeoutMs: 240_000 })
      )
    }
  )

  it.each(PROVIDERS)('uses the env template when nothing is selected [%s]', async (provider) => {
    useProvider(provider)
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)

    await executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 1000 })

    if (provider === 'e2b') {
      expect(mockE2BCreate).toHaveBeenCalledWith(
        'sim-function:f47ac10b-58cc-4372-a567-0e02b2c3d479',
        expect.anything()
      )
    } else {
      expect(mockDaytonaCreate).toHaveBeenCalledWith(
        expect.objectContaining({ snapshot: '7d9d12d6-5f2a-44df-9cc2-a20203f3813b' })
      )
    }
    // No selection means no install step, on either strategy. Code itself now
    // deliberately runs through the bounded process stream.
    expect(mockProvisionRuntime).not.toHaveBeenCalled()
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it.each(PROVIDERS)(
    'uses the Mothership image for trusted code and shell executions [%s]',
    async (provider) => {
      useProvider(provider)
      stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)

      await executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 1000,
        sandboxKind: 'mothership',
      })
      await executeShellInSandbox({
        code: 'echo ready',
        timeoutMs: 1000,
        sandboxKind: 'mothership',
      })

      if (provider === 'e2b') {
        expect(mockE2BCreate).toHaveBeenNthCalledWith(1, 'mothership-shell', expect.anything())
        expect(mockE2BCreate).toHaveBeenNthCalledWith(2, 'mothership-shell', expect.anything())
      } else {
        expect(mockDaytonaCreate).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ snapshot: 'mothership-shell:v1' })
        )
        expect(mockDaytonaCreate).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ snapshot: 'mothership-shell:v1' })
        )
      }
      expect(mockResolveSandbox).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ kind: 'mothership' })
      )
      expect(mockResolveSandbox).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ kind: 'mothership' })
      )
    }
  )

  it.each(PROVIDERS)(
    'does not let a workspace image displace the Mothership image [%s]',
    async (provider) => {
      useProvider(provider)
      const sandbox = await resolveProvider().create('mothership', {
        imageRef: 'workspace-controlled-image',
      })

      if (provider === 'e2b') {
        expect(mockE2BCreate).toHaveBeenCalledWith('mothership-shell', expect.anything())
      } else {
        expect(mockDaytonaCreate).toHaveBeenCalledWith(
          expect.objectContaining({ snapshot: 'mothership-shell:v1' })
        )
      }
      await sandbox.kill()
    }
  )

  it('fails closed when the Mothership E2B template is unset', async () => {
    useProvider('e2b')
    const original = mockEnv.MOTHERSHIP_E2B_TEMPLATE_ID
    mockEnv.MOTHERSHIP_E2B_TEMPLATE_ID = undefined
    try {
      await expect(e2bProvider.create('mothership')).rejects.toThrow(
        /MOTHERSHIP_E2B_TEMPLATE_ID is unset/
      )
      expect(mockE2BCreate).not.toHaveBeenCalled()
    } finally {
      mockEnv.MOTHERSHIP_E2B_TEMPLATE_ID = original
    }
  })

  it('fails closed when the Mothership Daytona snapshot is unset', async () => {
    useProvider('daytona')
    const original = mockEnv.DAYTONA_SHELL_SNAPSHOT_ID
    mockEnv.DAYTONA_SHELL_SNAPSHOT_ID = undefined
    try {
      await expect(daytonaProvider.create('mothership')).rejects.toThrow(
        /DAYTONA_SHELL_SNAPSHOT_ID is unset/
      )
      expect(mockDaytonaCreate).not.toHaveBeenCalled()
    } finally {
      mockEnv.DAYTONA_SHELL_SNAPSHOT_ID = original
    }
  })

  it('does not fall back from the Function E2B template to the Mothership template', async () => {
    const original = mockEnv.E2B_FUNCTION_TEMPLATE_ID
    mockEnv.E2B_FUNCTION_TEMPLATE_ID = undefined
    try {
      await expect(e2bProvider.create('code')).rejects.toThrow(/E2B_FUNCTION_TEMPLATE_ID is unset/)
      expect(mockE2BCreate).not.toHaveBeenCalled()
    } finally {
      mockEnv.E2B_FUNCTION_TEMPLATE_ID = original
    }
  })

  it('selects E2B for doc and Pi sandboxes without a Function template', async () => {
    useProvider('e2b')
    const original = mockEnv.E2B_FUNCTION_TEMPLATE_ID
    mockEnv.E2B_FUNCTION_TEMPLATE_ID = undefined
    try {
      const provider = resolveProvider()
      const doc = await provider.create('doc')
      const pi = await provider.create('pi')

      expect(provider.id).toBe('e2b')
      expect(mockE2BCreate).toHaveBeenNthCalledWith(1, 'mothership-docs', expect.anything())
      expect(mockE2BCreate).toHaveBeenNthCalledWith(2, 'sim-pi', expect.anything())
      await expect(provider.create('code')).rejects.toThrow(/E2B_FUNCTION_TEMPLATE_ID is unset/)
      await doc.kill()
      await pi.kill()
    } finally {
      mockEnv.E2B_FUNCTION_TEMPLATE_ID = original
    }
  })

  it('rejects a mutable Function E2B template alias at runtime', async () => {
    const original = mockEnv.E2B_FUNCTION_TEMPLATE_ID
    mockEnv.E2B_FUNCTION_TEMPLATE_ID = 'sim-function-latest'
    try {
      await expect(e2bProvider.create('code')).rejects.toThrow(
        /must be an immutable E2B build reference/
      )
      expect(mockE2BCreate).not.toHaveBeenCalled()
    } finally {
      mockEnv.E2B_FUNCTION_TEMPLATE_ID = original
    }
  })

  it('requires the monotonic Function E2B release generation at runtime', async () => {
    const original = mockEnv.E2B_FUNCTION_TEMPLATE_GENERATION
    mockEnv.E2B_FUNCTION_TEMPLATE_GENERATION = undefined
    try {
      await expect(e2bProvider.create('code')).rejects.toThrow(
        /E2B_FUNCTION_TEMPLATE_GENERATION is unset/
      )
      expect(mockE2BCreate).not.toHaveBeenCalled()
    } finally {
      mockEnv.E2B_FUNCTION_TEMPLATE_GENERATION = original
    }
  })

  it('rejects an invalid Function E2B release generation at runtime', async () => {
    const original = mockEnv.E2B_FUNCTION_TEMPLATE_GENERATION
    mockEnv.E2B_FUNCTION_TEMPLATE_GENERATION = 'latest'
    try {
      await expect(e2bProvider.create('shell')).rejects.toThrow(
        /must be a positive safe integer release generation/
      )
      expect(mockE2BCreate).not.toHaveBeenCalled()
    } finally {
      mockEnv.E2B_FUNCTION_TEMPLATE_GENERATION = original
    }
  })

  it('does not fall back from the Function Daytona snapshot to the Mothership snapshot', async () => {
    const original = mockEnv.DAYTONA_FUNCTION_SNAPSHOT_ID
    mockEnv.DAYTONA_FUNCTION_SNAPSHOT_ID = undefined
    try {
      await expect(daytonaProvider.create('shell')).rejects.toThrow(
        /DAYTONA_FUNCTION_SNAPSHOT_ID is unset/
      )
      expect(mockDaytonaCreate).not.toHaveBeenCalled()
    } finally {
      mockEnv.DAYTONA_FUNCTION_SNAPSHOT_ID = original
    }
  })

  it('selects Daytona for doc and Pi sandboxes without a Function snapshot', async () => {
    useProvider('daytona')
    const original = mockEnv.DAYTONA_FUNCTION_SNAPSHOT_ID
    mockEnv.DAYTONA_FUNCTION_SNAPSHOT_ID = undefined
    try {
      const provider = resolveProvider()
      const doc = await provider.create('doc')
      const pi = await provider.create('pi')

      expect(provider.id).toBe('daytona')
      expect(mockDaytonaCreate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ snapshot: 'mothership-docs:v1' })
      )
      expect(mockDaytonaCreate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ snapshot: 'sim-pi:v1' })
      )
      await expect(provider.create('code')).rejects.toThrow(/DAYTONA_FUNCTION_SNAPSHOT_ID is unset/)
      await doc.kill()
      await pi.kill()
    } finally {
      mockEnv.DAYTONA_FUNCTION_SNAPSHOT_ID = original
    }
  })

  it('rejects a mutable Function Daytona snapshot name at runtime', async () => {
    const original = mockEnv.DAYTONA_FUNCTION_SNAPSHOT_ID
    mockEnv.DAYTONA_FUNCTION_SNAPSHOT_ID = 'sim-function:latest'
    try {
      await expect(daytonaProvider.create('shell')).rejects.toThrow(
        /must be an immutable Daytona snapshot ID/
      )
      expect(mockDaytonaCreate).not.toHaveBeenCalled()
    } finally {
      mockEnv.DAYTONA_FUNCTION_SNAPSHOT_ID = original
    }
  })

  it.each(PROVIDERS)(
    'propagates the execution budget to sandbox lifetime and code timeout [%s]',
    async (provider) => {
      useProvider(provider)
      stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)

      await executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 46_000,
      })

      if (provider === 'e2b') {
        const sandboxTimeoutMs = mockE2BCreate.mock.calls[0][1].timeoutMs
        expect(sandboxTimeoutMs).toBeGreaterThan(45_000)
        expect(sandboxTimeoutMs).toBeLessThanOrEqual(46_000)
        const commandTimeoutMs = mockE2BCommandsRun.mock.calls.at(-1)?.[1].timeoutMs
        expect(commandTimeoutMs).toBeGreaterThan(45_000)
        expect(commandTimeoutMs).toBeLessThanOrEqual(46_000)
      } else {
        expect(mockDaytonaCreate.mock.calls[0][0]).toMatchObject({
          ephemeral: true,
          ttlMinutes: 1,
        })
        expect(mockExecuteSessionCommand.mock.calls.at(-1)?.[2]).toBe(46)
      }
    }
  )

  it.each(PROVIDERS)('does not raise a sub-15s caller budget [%s]', async (provider) => {
    useProvider(provider)
    stubCodeRun(provider, `${SIM_RESULT_PREFIX}null`)

    await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 1000,
    })

    if (provider === 'e2b') {
      const commandTimeoutMs = mockE2BCommandsRun.mock.calls.at(-1)?.[1].timeoutMs
      expect(commandTimeoutMs).toBeGreaterThan(0)
      expect(commandTimeoutMs).toBeLessThanOrEqual(1000)
    } else {
      expect(mockExecuteSessionCommand.mock.calls.at(-1)?.[2]).toBe(1)
    }
  })

  it('declares one strategy per provider, and only the prebuilt one can build', () => {
    expect(e2bProvider.dependencyStrategy).toBe('prebuilt')
    expect(e2bProvider.images).toBeDefined()
    expect(daytonaProvider.dependencyStrategy).toBe('runtime')
    expect(daytonaProvider.images).toBeUndefined()
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

  it('restores E2B PATH after login startup without inlining environment values', async () => {
    useProvider('e2b')
    const sandbox = await e2bProvider.create('shell')
    const path = '/opt/sim-cli/kubectl/bin:/usr/bin:/bin'
    const secret = 'must-stay-out-of-command-source'

    await sandbox.runCommand('kubectl version --client', {
      timeoutMs: 1000,
      envs: {
        PATH: path,
        SECRET_VALUE: secret,
        __SIM_E2B_COMMAND_PATH: 'preserve-user-value',
      },
    })

    const [command, options] = mockE2BCommandsRun.mock.calls.at(-1) ?? []
    expect(command).toContain(
      'export PATH="$__SIM_E2B_COMMAND_PATH_"; unset __SIM_E2B_COMMAND_PATH_'
    )
    expect(command).toContain('kubectl version --client')
    expect(command).not.toContain(path)
    expect(command).not.toContain(secret)
    expect(options.envs).toMatchObject({
      SECRET_VALUE: secret,
      __SIM_E2B_COMMAND_PATH: 'preserve-user-value',
      __SIM_E2B_COMMAND_PATH_: path,
    })
    expect(options.envs).not.toHaveProperty('PATH')

    await sandbox.kill()
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
    stubShellCommand('daytona', `${SIM_RESULT_PREFIX}null`, '', 0)

    await executeInSandbox({ code: 'x', language: CodeLanguage.JavaScript, timeoutMs: 1000 })

    expect(mockDaytonaCreate).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'javascript' })
    )
    expect(mockExecuteSessionCommand).toHaveBeenCalledTimes(1)
    expect(mockProcessCodeRun).not.toHaveBeenCalled()
    expect(mockInterpreterRunCode).not.toHaveBeenCalled()
    expect(mockCreateFolder).not.toHaveBeenCalled()
    expect(mockDeleteFile).toHaveBeenCalledWith(expect.stringMatching(/^\.sim-function-/), false)
  })

  it.each(PROVIDERS)('runs the trusted JavaScript preload on %s', async (provider) => {
    useProvider(provider)
    stubShellCommand(provider, `${SIM_RESULT_PREFIX}null`, '', 0)

    await executeInSandbox({
      code: 'return null',
      language: CodeLanguage.JavaScript,
      timeoutMs: 1000,
      runtimeBindings: [{ name: '__opaque_intrinsic', kind: 'javascript-runtime' }],
    })

    const preloadContent =
      provider === 'e2b'
        ? mockE2BFilesWrite.mock.calls.find(([path]) => String(path).endsWith('.cjs'))?.[1]
        : mockUploadFile.mock.calls.find(([, path]) => String(path).endsWith('.cjs'))?.[0]
    expect(sandboxWriteBuffer(preloadContent).toString('utf8')).toContain(
      'objectConstructor.defineProperty(globalThis, "__opaque_intrinsic"'
    )

    if (provider === 'e2b') {
      expect(mockE2BCommandsRun.mock.calls.at(-1)?.[1].envs.SIM_PRELOAD_PATH).toMatch(
        /^\.\/\.sim-function-[A-Za-z0-9_-]+\.cjs$/
      )
    } else {
      const uploadedFunctionPaths = mockUploadFile.mock.calls
        .map(([, path]) => String(path))
        .filter((path) => path.includes('.sim-function-'))
      expect(uploadedFunctionPaths).toHaveLength(3)
      expect(uploadedFunctionPaths).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^\.sim-function-[A-Za-z0-9_-]+\.mjs$/),
          expect.stringMatching(/^\.sim-function-[A-Za-z0-9_-]+\.cjs$/),
          expect.stringMatching(/^\.sim-function-[A-Za-z0-9_-]+\.sh$/),
        ])
      )
      const environmentWrite = mockUploadFile.mock.calls.find(([, path]) =>
        String(path).startsWith('/tmp/.sim-env-')
      )?.[0]
      const environment = sandboxWriteBuffer(environmentWrite).toString('utf8')
      expect(environment).toMatch(/SIM_CODE_PATH='\.sim-function-[A-Za-z0-9_-]+\.mjs'/)
      expect(environment).toMatch(/SIM_PRELOAD_PATH='\.\/\.sim-function-[A-Za-z0-9_-]+\.cjs'/)
      const launcher = mockUploadFile.mock.calls.find(([, path]) =>
        String(path).endsWith('.sh')
      )?.[0]
      expect(sandboxWriteBuffer(launcher).toString('utf8')).toContain(
        'ln -s "$SIM_NODE_MODULES_PATH" node_modules'
      )
    }
  })

  it('hard-stops Daytona JavaScript output through the streamed module runner', async () => {
    useProvider('daytona')
    const oversized = 'x'.repeat(MAX_SANDBOX_PROCESS_OUTPUT_BYTES + 1)
    mockGetSessionCommandLogs.mockImplementationOnce(async (_sessionId, _commandId, onStdout) => {
      emitDaytonaStreamReady(onStdout)
      onStdout(oversized)
    })

    await expect(
      executeInSandbox({
        code: 'console.log("x")',
        language: CodeLanguage.JavaScript,
        timeoutMs: 1000,
      })
    ).rejects.toMatchObject({
      code: 'sandbox_output_limit_exceeded',
      outputKind: 'process',
    })
    expect(mockProcessCodeRun).not.toHaveBeenCalled()
    expect(mockDeleteFile).toHaveBeenCalledTimes(3)
    expect(mockDelete).toHaveBeenCalledTimes(1)
  })

  it('applies the default process-output cap before Daytona buffers command output', async () => {
    useProvider('daytona')
    const oversized = 'x'.repeat(MAX_SANDBOX_PROCESS_OUTPUT_BYTES + 1)
    mockGetSessionCommandLogs.mockImplementationOnce(async (_sessionId, _commandId, onStdout) => {
      emitDaytonaStreamReady(onStdout)
      onStdout(oversized)
    })
    const sandbox = await daytonaProvider.create('shell')

    await expect(sandbox.runCommand('emit-output', { timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'sandbox_output_limit_exceeded',
      outputKind: 'process',
      limitBytes: MAX_SANDBOX_PROCESS_OUTPUT_BYTES,
    })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledTimes(1)
  })

  it('rejects unsafe Daytona environment names before creating a process session', async () => {
    useProvider('daytona')
    const sandbox = await daytonaProvider.create('shell')

    await expect(
      sandbox.runCommand('true', {
        envs: { 'SAFE\n$(touch /tmp/injected)': 'value' },
        timeoutMs: 1000,
      })
    ).rejects.toThrow(/environment variable names/)
    expect(mockCreateSession).not.toHaveBeenCalled()
    expect(mockUploadFile).not.toHaveBeenCalled()
    await sandbox.kill()
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
    const result = await withPiSandbox({}, (runner) =>
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

  it('enforces the timeout on a hung streaming command', async () => {
    useProvider('daytona')
    // runAsync returns immediately, so a never-resolving log stream must be
    // bounded by the timeout rather than awaited forever.
    mockGetSessionCommandLogs.mockReturnValue(new Promise<void>(() => {}))

    const result = await withPiSandbox({}, (runner) =>
      runner.run('hang forever', { timeoutMs: 20, onStdout: () => {} })
    )

    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain('timed out')
    // The session is deleted to terminate the still-running command.
    expect(mockDeleteSession).toHaveBeenCalled()
  })

  it('surfaces the thrown error when the stream rejects', async () => {
    useProvider('daytona')
    // A failure with no chunks streamed must still carry the error detail, not an
    // empty/opaque message.
    mockGetSessionCommandLogs.mockRejectedValue(new Error('session died'))

    const result = await withPiSandbox({}, (runner) =>
      runner.run('git clone ...', { timeoutMs: 1000, onStdout: () => {} })
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('session died')
  })

  it('surfaces the error when starting the streamed command throws', async () => {
    useProvider('daytona')
    mockExecuteSessionCommand.mockRejectedValue(new Error('start failed'))

    const result = await withPiSandbox({}, (runner) =>
      runner.run('git clone ...', { timeoutMs: 1000, onStdout: () => {} })
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('start failed')
  })
})

describe('Pi sandbox lifetime', () => {
  afterEach(() => {
    mockEnv.PI_SANDBOX_LIFETIME_MS = undefined
  })

  it('asks E2B for a lifetime that outlasts the longest execution', async () => {
    useProvider('e2b')

    await withPiSandbox({}, async () => undefined)

    const [template, options] = mockE2BCreate.mock.calls[0]
    expect(template).toBe('sim-pi')
    // E2B's default is five minutes, which kills any Pi run that outlives it.
    expect(options.timeoutMs).toBe(resolvePiSandboxLifetimeMs())
    // The execution ceiling may exceed one continuous E2B session; the provider
    // hard limit remains authoritative for this sandbox.
    expect(options.timeoutMs).toBeLessThanOrEqual(getMaxExecutionTimeout())
    expect(options.timeoutMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
  })

  it('clamps a configured lifetime that would exceed the ceiling', async () => {
    useProvider('e2b')
    mockEnv.PI_SANDBOX_LIFETIME_MS = '90000000'

    await withPiSandbox({}, async () => undefined)

    expect(mockE2BCreate.mock.calls[0][1].timeoutMs).toBe(resolvePiSandboxLifetimeMs())
  })

  it('honours a configured lifetime between the floor and the ceiling', async () => {
    useProvider('e2b')
    mockEnv.PI_SANDBOX_LIFETIME_MS = '2700000'

    await withPiSandbox({}, async () => undefined)

    expect(mockE2BCreate.mock.calls[0][1].timeoutMs).toBe(2_700_000)
  })

  it('raises a configured lifetime too short to clone, run, and push in', async () => {
    useProvider('e2b')
    // Ten minutes is the clone reserve on its own, so the turn and the push would
    // race a sandbox E2B may already have reaped.
    mockEnv.PI_SANDBOX_LIFETIME_MS = '600000'

    await withPiSandbox({}, async () => undefined)

    expect(mockE2BCreate.mock.calls[0][1].timeoutMs).toBe(PI_SANDBOX_MIN_LIFETIME_MS)
  })

  it('propagates short-lived execution budgets to E2B', async () => {
    useProvider('e2b')
    stubCodeRun('e2b', `${SIM_RESULT_PREFIX}null`)

    await executeInSandbox({ code: 'x', language: CodeLanguage.Python, timeoutMs: 1000 })

    const timeoutMs = mockE2BCreate.mock.calls[0][1].timeoutMs
    expect(timeoutMs).toBeGreaterThan(0)
    expect(timeoutMs).toBeLessThanOrEqual(1000)
  })

  it('caps a long workflow call to E2B continuous lifetime without rejecting it', async () => {
    useProvider('e2b')
    stubCodeRun('e2b', `${SIM_RESULT_PREFIX}null`)

    await executeInSandbox({
      code: 'x',
      language: CodeLanguage.Python,
      timeoutMs: 7 * 24 * 60 * 60 * 1000,
    })

    expect(mockE2BCreate.mock.calls[0][1].timeoutMs).toBe(E2B_MAX_SANDBOX_LIFETIME_MS)
    expect(mockE2BCommandsRun.mock.calls.at(-1)?.[1].timeoutMs).toBe(E2B_MAX_SANDBOX_LIFETIME_MS)
  })

  it('caps long shell commands to E2B continuous lifetime', async () => {
    useProvider('e2b')

    await executeShellInSandbox({
      code: 'sleep 1',
      timeoutMs: 7 * 24 * 60 * 60 * 1000,
    })

    expect(mockE2BCreate.mock.calls[0][1].timeoutMs).toBe(E2B_MAX_SANDBOX_LIFETIME_MS)
    expect(mockE2BCommandsRun.mock.calls[0][1].timeoutMs).toBe(E2B_MAX_SANDBOX_LIFETIME_MS)
  })

  it('does not call an early timeout the 24-hour provider limit', async () => {
    useProvider('e2b')
    mockE2BCommandsRun.mockRejectedValueOnce(providerTimeoutError('e2b'))

    await expect(
      executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 7 * 24 * 60 * 60 * 1000,
      })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'timeout' })
    expect(mockRecordSandboxProviderLimit).not.toHaveBeenCalled()
  })

  it('does not call cancellation near 24 hours a provider-limit event', async () => {
    useProvider('e2b')
    const controller = new AbortController()
    const timeoutError = providerTimeoutError('e2b')
    mockE2BCommandsRun.mockImplementationOnce(async () => {
      controller.abort(new DOMException('user', 'AbortError'))
      throw timeoutError
    })
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(E2B_MAX_SANDBOX_LIFETIME_MS)

    try {
      await expect(
        executeInSandbox({
          code: 'x',
          language: CodeLanguage.Python,
          timeoutMs: 7 * 24 * 60 * 60 * 1000,
          signal: controller.signal,
        })
      ).rejects.toMatchObject({ name: 'AbortError', message: 'user' })
      expect(mockRecordSandboxProviderLimit).not.toHaveBeenCalled()
    } finally {
      now.mockRestore()
    }
  })

  it('explains the provider limit when a capped E2B execution reaches 24 hours', async () => {
    useProvider('e2b')
    const timeoutError = new Error('Execution timed out — the timeoutMs option was reached')
    timeoutError.name = 'TimeoutError'
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    mockE2BCommandsRun.mockImplementationOnce(async () => {
      now.mockReturnValue(E2B_MAX_SANDBOX_LIFETIME_MS)
      throw timeoutError
    })

    try {
      const result = await executeInSandbox({
        code: 'x',
        language: CodeLanguage.Python,
        timeoutMs: 7 * 24 * 60 * 60 * 1000,
      })

      expect(result.error).toContain('E2B reached its 24-hour limit')
      expect(result.error).toContain('workflow timeout may be longer')
      expect(mockRecordSandboxProviderLimit).toHaveBeenCalledWith({
        provider: 'e2b',
        operation: 'code',
      })
    } finally {
      now.mockRestore()
    }
  })

  it('records the provider limit when a capped E2B shell command reaches 24 hours', async () => {
    useProvider('e2b')
    const timeoutError = new Error("Deadline exceeded: likely due to exceeding 'timeoutMs'")
    timeoutError.name = 'TimeoutError'
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    mockE2BCommandsRun.mockImplementationOnce(async () => {
      now.mockReturnValue(E2B_MAX_SANDBOX_LIFETIME_MS)
      throw timeoutError
    })

    try {
      const result = await executeShellInSandbox({
        code: 'sleep infinity',
        timeoutMs: 7 * 24 * 60 * 60 * 1000,
      })

      expect(result.error).toContain('E2B reached its 24-hour limit')
      expect(mockRecordSandboxProviderLimit).toHaveBeenCalledWith({
        provider: 'e2b',
        operation: 'command',
      })
    } finally {
      now.mockRestore()
    }
  })

  it("honours a caller's lifetime below the ceiling", async () => {
    useProvider('e2b')

    // This is the run's own execution deadline arriving from the backend. It is
    // deliberately not subject to PI_SANDBOX_MIN_LIFETIME_MS: that floor guards a
    // misconfigured env var, whereas a short deadline is a fact about the run,
    // and rounding it up is what left a five-minute run's sandbox billing for an
    // hour.
    await withPiSandbox({ lifetimeMs: 4 * 60 * 1000 }, async () => undefined)

    expect(mockE2BCreate.mock.calls[0][1].timeoutMs).toBe(4 * 60 * 1000)
  })

  it('does not read an expired lifetime as no lifetime at all', async () => {
    useProvider('e2b')

    // Zero is what a run past its deadline resolves to. Testing it for
    // truthiness would drop the key and hand that run E2B's five-minute default
    // — longer than the ceiling it asked for, on the run least entitled to it.
    await withPiSandbox({ lifetimeMs: 0 }, async () => undefined)

    expect(mockE2BCreate.mock.calls[0][1]).toHaveProperty('timeoutMs', 0)
  })

  it('creates Daytona sandboxes as ephemeral with a wall-clock TTL', async () => {
    useProvider('daytona')

    await withPiSandbox({}, async () => undefined)

    expect(mockDaytonaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: 'sim-pi:v1',
        ephemeral: true,
        ttlMinutes: Math.ceil(resolvePiSandboxLifetimeMs() / 60_000),
      })
    )
  })
})
