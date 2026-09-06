/**
 * @vitest-environment node
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'
import { SANDBOX_OUTPUT_DIR_SENTINEL } from '@/lib/execution/remote-sandbox/sandbox-paths'
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
import { observeSandboxExecution } from '@/lib/execution/remote-sandbox/execution-observer'
import { writeSessionSandboxFile } from '@/lib/execution/remote-sandbox/session-files'

interface FakeSandboxCalls {
  runCode: Array<{ code: string; envs?: Record<string, string> }>
  runCommand: Array<{ command: string; envs?: Record<string, string>; rootUser?: boolean }>
  extendLifetime: number[]
  killed: boolean
}

function fakeSandbox(id: string): { handle: SandboxHandle; calls: FakeSandboxCalls } {
  const files = new Map<string, string | ArrayBuffer>()
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
      calls.runCommand.push({
        command,
        rootUser: options.rootUser,
        ...(options.envs ? { envs: options.envs } : {}),
      })
      const cliPath = options.envs?.SIM_CLI_PATH
      if (cliPath) {
        const content = files.get(cliPath)
        const hash =
          content === undefined
            ? undefined
            : createHash('sha256')
                .update(typeof content === 'string' ? content : new Uint8Array(content))
                .digest('hex')
        return { stdout: '', stderr: '', exitCode: hash === options.envs?.SIM_CLI_SHA256 ? 0 : 10 }
      }
      const stage = options.envs?.SIM_FILE_STAGE
      const target = options.envs?.SIM_FILE_TARGET
      if (stage && target) {
        const content = files.get(stage)
        if (content !== undefined) {
          files.set(target, content)
          files.delete(stage)
        }
      }
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
    async writeFile(path, content) {
      files.set(path, content)
    },
    async removeFile(path) {
      files.delete(path)
    },
    async listFiles() {
      return []
    },
    async kill() {
      calls.killed = true
    },
  }
  return { handle, calls }
}

/** A fake executes instantly; a priced call needs measurable wall time. */
function slowDown(handle: SandboxHandle): void {
  const original = handle.runCode.bind(handle)
  handle.runCode = async (code, options) => {
    await sleep(25)
    return original(code, options)
  }
}

const CLI = { path: '/home/user/.sim-cli/release/cli.mjs', content: 'deployment-code' }

const CODE_REQUEST = {
  code: 'print(1)',
  language: CodeLanguage.Python,
  timeoutMs: 30_000,
}

describe('session sandbox lease', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveWorkspaceSandbox.mockResolvedValue(null)
  })

  it.each(['code', 'shell'] as const)(
    'refuses %s before touching the provider when previous work is unresolved',
    async (kind) => {
      const request = { ...CODE_REQUEST, session: { key: `unresolved-${kind}` } }
      await expect(
        observeSandboxExecution(
          {
            hold: () => {},
            unsettled: () => {},
            sessionAccess: async () => {
              throw new Error('Earlier work is unresolved')
            },
          },
          () =>
            kind === 'code'
              ? executeInSandbox(request)
              : executeShellInSandbox({ ...request, envs: {} })
        )
      ).rejects.toThrow('Earlier work is unresolved')
      expect(mockFindSessionSandbox).not.toHaveBeenCalled()
      expect(mockCreate).not.toHaveBeenCalled()
    }
  )

  it.each(['code', 'shell'] as const)(
    'keeps a cancelled session %s operation owned until its process settles',
    async (kind) => {
      const { handle, calls } = fakeSandbox(`stopping-${kind}`)
      mockFindSessionSandbox.mockResolvedValue(handle)
      let entered!: () => void
      let finish!: () => void
      const running = new Promise<void>((resolve) => {
        entered = resolve
      })
      const stopped = new Promise<void>((resolve) => {
        finish = resolve
      })
      let processRunning = false
      const execute = async () => {
        processRunning = true
        entered()
        await stopped
        processRunning = false
        throw new Error('Process stopped')
      }
      handle.runCode = execute
      handle.runCommand = execute
      const controller = new AbortController()
      const request = {
        ...CODE_REQUEST,
        session: { key: `stopping-${kind}` },
        signal: controller.signal,
      }
      let settled = false
      const result = (
        kind === 'code'
          ? executeInSandbox(request)
          : executeShellInSandbox({ ...request, envs: {} })
      ).then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )
      await running
      controller.abort(new Error('User Stop'))
      try {
        await sleep(1)
        expect(processRunning).toBe(true)
        expect(settled).toBe(false)
      } finally {
        finish()
        await result
      }
      expect(processRunning).toBe(false)
      expect(settled).toBe(true)
      expect(calls.killed).toBe(false)
    }
  )

  it('keeps a native file-writing process owned until its cancellation completes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mship-stop-process-'))
    const artifact = join(directory, 'artifact.txt')
    const { handle, calls } = fakeSandbox('native-stop')
    mockFindSessionSandbox.mockResolvedValue(handle)
    let entered!: () => void
    const running = new Promise<void>((resolve) => {
      entered = resolve
    })
    let allowKill!: () => void
    const killAllowed = new Promise<void>((resolve) => {
      allowKill = resolve
    })
    let child: ReturnType<typeof execFile> | undefined
    let exited: Promise<void> | undefined
    handle.runCode = async () => {
      child = execFile(process.execPath, [
        '-e',
        `
        const fs = require('node:fs');
        const artifact = process.argv[1];
        fs.writeFileSync(artifact, 'before');
        process.stdout.write('ready\\n');
        process.stdin.on('data', () => {
          fs.appendFileSync(artifact, ':after-stop');
          process.stdout.write('wrote\\n');
        });
        setTimeout(() => process.exit(2), 5000);
      `,
        artifact,
      ])
      exited = once(child, 'close').then(() => undefined)
      if (!child.stdout) throw new Error('Missing child output')
      await once(child.stdout, 'data')
      entered()
      await killAllowed
      child.kill('SIGKILL')
      await exited
      throw new Error('Process stopped')
    }
    const controller = new AbortController()
    let settled = false
    const result = executeInSandbox({
      ...CODE_REQUEST,
      session: { key: 'native-stop' },
      signal: controller.signal,
    }).then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    try {
      await running
      controller.abort(new Error('User Stop'))
      if (!child?.stdout || !child.stdin) throw new Error('Missing child transport')
      const written = once(child.stdout, 'data')
      child.stdin.write('write\n')
      await written
      expect(await readFile(artifact, 'utf8')).toBe('before:after-stop')
      expect(settled).toBe(false)
      allowKill()
      await result
      expect(child.signalCode).toBe('SIGKILL')
      expect(settled).toBe(true)
      expect(calls.killed).toBe(false)
    } finally {
      allowKill()
      child?.kill('SIGKILL')
      await Promise.allSettled([result, exited])
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('observes disposable cleanup without changing its prompt cancellation behavior', async () => {
    const { handle } = fakeSandbox('disposable-cleanup')
    mockCreate.mockResolvedValue(handle)
    let entered!: () => void
    const running = new Promise<void>((resolve) => {
      entered = resolve
    })
    let allowKill!: () => void
    const killAllowed = new Promise<void>((resolve) => {
      allowKill = resolve
    })
    handle.kill = () => killAllowed
    handle.runCode = (_code, options) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
          once: true,
        })
        entered()
      })
    const underlying: Promise<unknown>[] = []
    let underlyingSettled = false
    const controller = new AbortController()
    const result = observeSandboxExecution(
      {
        hold: (work) => {
          underlying.push(work)
          void work.then(
            () => {
              underlyingSettled = true
            },
            () => {
              underlyingSettled = true
            }
          )
        },
        unsettled: vi.fn(),
      },
      () => executeInSandbox({ ...CODE_REQUEST, signal: controller.signal })
    )
    try {
      await running
      controller.abort(new Error('User Stop'))
      await expect(result).rejects.toThrow('User Stop')
      expect(underlying).toHaveLength(1)
      expect(underlyingSettled).toBe(false)
    } finally {
      allowKill()
      await Promise.allSettled([result, ...underlying])
    }
    expect(underlyingSettled).toBe(true)
  })

  it('overlapping first file and code calls use one machine and preserve the input bytes', async () => {
    const { handle, calls } = fakeSandbox('shared-file-code')
    const files = new Map<string, string | ArrayBuffer>()
    const write = handle.writeFile.bind(handle)
    handle.writeFile = async (path, content) => {
      files.set(path, content)
      await write(path, content)
    }
    const runCommand = handle.runCommand.bind(handle)
    handle.runCommand = async (command, options) => {
      const stage = options.envs?.SIM_FILE_STAGE
      const target = options.envs?.SIM_FILE_TARGET
      if (stage && target) {
        const content = files.get(stage)
        if (content === undefined) throw new Error('Missing staged bytes')
        files.set(target, content)
        files.delete(stage)
      }
      return runCommand(command, options)
    }
    let current: SandboxHandle | null = null
    mockFindSessionSandbox.mockImplementation(async () => current)
    mockCreate.mockImplementation(async () => {
      await sleep(10)
      current = handle
      return handle
    })
    const runCode = handle.runCode.bind(handle)
    handle.runCode = async (code, options) => {
      const content = files.get('/home/user/source.bin')
      if (!(content instanceof ArrayBuffer)) throw new Error('Missing binary input')
      expect(new Uint8Array(content)).toEqual(bytes)
      return runCode(code, options)
    }
    const bytes = Uint8Array.from([0, 255, 128, 65])
    const [written, executed] = await Promise.all([
      writeSessionSandboxFile('first-file-code', 'source.bin', bytes),
      executeInSandbox({
        ...CODE_REQUEST,
        sandboxKind: 'mothership',
        session: { key: 'first-file-code', cli: CLI },
      }),
    ])
    expect(written.outcome).toBe('written')
    expect(executed.sandboxSession).toBe('reused')
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(calls.runCommand.at(-1)?.envs?.SIM_CLI_PATH).toBe(CLI.path)
    expect(calls.killed).toBe(false)
  })

  it('releases only its own private payloads when parallel jobs share the machine', async () => {
    const { handle, calls } = fakeSandbox('private-inputs')
    const files = new Map<string, string | ArrayBuffer>([['/home/user/report.txt', 'keep']])
    handle.writeFile = async (path, content) => {
      files.set(path, content)
    }
    handle.removeFile = async (path) => {
      files.delete(path)
    }
    mockFindSessionSandbox.mockResolvedValue(handle)
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    let entered = 0
    let ready!: () => void
    const bothRunning = new Promise<void>((resolve) => {
      ready = resolve
    })
    handle.runCode = async (_code, options) => {
      const path = options.envs?.PAYLOAD
      if (!path) throw new Error('Missing input path')
      const value = files.get(path)
      if (++entered === 2) ready()
      await (value === 'first' ? first : second)
      expect(files.get(path)).toBe(value)
      return { text: SIM_RESULT_PREFIX + JSON.stringify(value), stdout: '', stderr: '' }
    }
    const run = (content: string) =>
      executeInSandbox({
        ...CODE_REQUEST,
        session: { key: 'parallel-private' },
        privateInputs: [{ environmentVariable: 'PAYLOAD', content }],
      })
    const firstRun = run('first')
    const secondRun = run('second')
    await bothRunning
    releaseFirst()
    try {
      await firstRun
      expect([...files.values()]).toEqual(['keep', 'second'])
    } finally {
      releaseSecond()
      await secondRun
    }
    expect([...files.entries()]).toEqual([['/home/user/report.txt', 'keep']])
    expect(calls.killed).toBe(false)
  })

  it.each(['code', 'shell'] as const)(
    'cleans failed private uploads in a persistent %s session',
    async (kind) => {
      const { handle, calls } = fakeSandbox('failed-private-upload')
      const files = new Map<string, string | ArrayBuffer>([['/home/user/report.txt', 'keep']])
      handle.writeFile = async (path, content) => {
        files.set(path, content)
        if (content === 'second') throw new Error('Upload acknowledgement lost')
      }
      handle.removeFile = async (path) => {
        files.delete(path)
      }
      mockFindSessionSandbox.mockResolvedValue(handle)
      const request = {
        ...CODE_REQUEST,
        session: { key: 'failed-private-upload' },
        privateInputs: [
          { environmentVariable: 'FIRST', content: 'first' },
          { environmentVariable: 'SECOND', content: 'second' },
        ],
      }
      await expect(
        kind === 'code'
          ? executeInSandbox(request)
          : executeShellInSandbox({ ...request, envs: {} })
      ).rejects.toThrow('Upload acknowledgement lost')
      expect(calls.runCode).toEqual([])
      expect(calls.runCommand).toEqual([])
      expect([...files.entries()]).toEqual([['/home/user/report.txt', 'keep']])
      expect(calls.killed).toBe(false)
    }
  )

  it('collects only each call’s exports while code and shell share the workbench', async () => {
    const { handle, calls } = fakeSandbox('parallel-exports')
    const files = new Map<string, string>([
      ['/home/user/source.txt', 'shared input'],
      ['/tmp/sim/outputs/previous/report.txt', 'old report'],
    ])
    handle.writeFile = async (path, content) => {
      if (typeof content !== 'string') throw new Error('Expected text fixture')
      files.set(path, content)
    }
    handle.listFiles = async (directory) =>
      [...files].flatMap(([path, content]) =>
        path.startsWith(`${directory}/`)
          ? [
              {
                path,
                relativePath: path.slice(directory.length + 1),
                kind: 'file',
                size: content.length,
              },
            ]
          : []
      )
    handle.readFileWithLimit = async (path) => {
      const content = files.get(path)
      if (content === undefined) throw new Error('Missing file')
      return { content: Buffer.from(content).toString('base64'), byteLength: content.length }
    }
    mockFindSessionSandbox.mockResolvedValue(handle)
    let ready!: () => void
    const bothRunning = new Promise<void>((resolve) => {
      ready = resolve
    })
    let entered = 0
    const produce = async (content: string, envs?: Record<string, string>) => {
      const directory = envs?.SIM_OUTPUT_DIR
      if (!directory) throw new Error('Missing export directory')
      expect(files.get(`${directory}/${SANDBOX_OUTPUT_DIR_SENTINEL}`)).toBe('')
      expect(files.get('/home/user/source.txt')).toBe('shared input')
      files.set(`${directory}/report.txt`, content)
      if (++entered === 2) ready()
      await bothRunning
    }
    handle.runCode = async (_code, options) => {
      await produce('code report', options.envs)
      return { text: `${SIM_RESULT_PREFIX}true`, stdout: '', stderr: '' }
    }
    handle.runCommand = async (_code, options) => {
      await produce('shell report', options.envs)
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    const [code, shell] = await Promise.all([
      executeInSandbox({
        ...CODE_REQUEST,
        session: { key: 'parallel-export' },
        outputSandboxDir: '/tmp/sim/outputs/code',
      }),
      executeShellInSandbox({
        code: 'export',
        envs: { SIM_OUTPUT_DIR: 'caller-override' },
        timeoutMs: 30_000,
        session: { key: 'parallel-export' },
        outputSandboxDir: '/tmp/sim/outputs/shell',
      }),
    ])
    for (const [result, content] of [
      [code, 'code report'],
      [shell, 'shell report'],
    ] as const) {
      expect(result.collectedFiles).toEqual([
        expect.objectContaining({
          relativePath: 'report.txt',
          contentBase64: Buffer.from(content).toString('base64'),
        }),
      ])
    }
    expect(files.get('/tmp/sim/outputs/previous/report.txt')).toBe('old report')
    expect(calls.killed).toBe(false)
  })

  it('keeps a completed result when temporary input cleanup is unavailable', async () => {
    const { handle, calls } = fakeSandbox('cleanup-failure')
    mockFindSessionSandbox.mockResolvedValue(handle)
    handle.removeFile = async () => {
      throw new Error('Provider cleanup unavailable')
    }
    const result = await executeInSandbox({
      ...CODE_REQUEST,
      session: { key: 'cleanup-failure' },
      privateInputs: [{ environmentVariable: 'PAYLOAD', content: 'input' }],
    })
    expect(result.result).toEqual({ ok: true })
    expect(calls.runCode).toHaveLength(1)
    expect(calls.killed).toBe(false)
  })

  it.each(['inline', 'url'])(
    'preserves a shared input when a replacement %s mount fails',
    async (kind) => {
      const directory = await mkdtemp(join(tmpdir(), 'mship-mount-'))
      const target = join(directory, 'source.txt')
      const exec = promisify(execFile)
      const { handle, calls } = fakeSandbox(`failed-${kind}-mount`)
      mockFindSessionSandbox.mockResolvedValue(handle)
      handle.writeFile = async (path) => {
        await writeFile(path, 'partial replacement')
        throw new Error('Upload failed after bytes arrived')
      }
      handle.removeFile = async (path) => {
        await rm(path, { force: true })
      }
      handle.runCommand = async (command, options) => {
        try {
          const result = await exec('/bin/sh', ['-c', command], {
            env: { ...process.env, ...options.envs },
            signal: options.signal,
          })
          return { ...result, exitCode: 0 }
        } catch (error) {
          return { stdout: '', stderr: getErrorMessage(error), exitCode: 1 }
        }
      }
      try {
        await writeFile(target, 'published input')
        await expect(
          executeInSandbox({
            ...CODE_REQUEST,
            session: { key: `mount-${kind}` },
            sandboxFiles:
              kind === 'inline'
                ? [{ path: target, content: 'replacement' }]
                : [{ type: 'url', path: target, url: `file://${directory}/absent-source` }],
          })
        ).rejects.toThrow()
        expect(await readFile(target, 'utf8')).toBe('published input')
        expect(await readdir(directory)).toEqual(['source.txt'])
        expect(calls.runCode).toHaveLength(0)
        expect(calls.killed).toBe(false)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )

  it('lets running code read a complete input while another call uploads its replacement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mship-reading-mount-'))
    const target = join(directory, 'source.txt')
    const exec = promisify(execFile)
    const { handle, calls } = fakeSandbox('reading-mount')
    mockFindSessionSandbox.mockResolvedValue(handle)
    let staged!: () => void
    let finish!: () => void
    const uploadStarted = new Promise<void>((resolve) => {
      staged = resolve
    })
    const uploadFinished = new Promise<void>((resolve) => {
      finish = resolve
    })
    handle.writeFile = async (path, content) => {
      await writeFile(path, 'partial')
      staged()
      await uploadFinished
      await writeFile(path, typeof content === 'string' ? content : new Uint8Array(content))
    }
    handle.removeFile = async (path) => {
      await rm(path, { force: true })
    }
    handle.runCommand = async (command, options) => {
      const result = await exec('/bin/sh', ['-c', command], {
        env: { ...process.env, ...options.envs },
        signal: options.signal,
      })
      return { ...result, exitCode: 0 }
    }
    handle.runCode = async () => ({
      text: SIM_RESULT_PREFIX + JSON.stringify(await readFile(target, 'utf8')),
      stdout: '',
      stderr: '',
    })
    await writeFile(target, 'published input')
    const session = { key: 'reading-mount' }
    const replacement = executeInSandbox({
      ...CODE_REQUEST,
      session,
      sandboxFiles: [{ path: target, content: 'complete replacement' }],
    })
    try {
      await uploadStarted
      const reader = await executeInSandbox({ ...CODE_REQUEST, session })
      expect(reader.result).toBe('published input')
    } finally {
      finish()
      try {
        const result = await replacement
        expect(result.result).toBe('complete replacement')
        expect(await readdir(directory)).toEqual(['source.txt'])
        expect(calls.killed).toBe(false)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  })

  it('creates a tagged sandbox, bootstraps it, and keeps it alive', async () => {
    const { handle, calls } = fakeSandbox('sb-fresh')
    mockFindSessionSandbox.mockResolvedValue(null)
    mockCreate.mockResolvedValue(handle)

    const result = await executeInSandbox({
      ...CODE_REQUEST,
      sandboxKind: 'mothership',
      session: { key: 'mothership-chat:c1', cli: CLI },
    })

    expect(result.sandboxSession).toBe('created')
    expect(mockCreate).toHaveBeenCalledWith(
      'mothership',
      expect.objectContaining({ sessionKey: 'mothership-chat:c1' })
    )
    expect(calls.runCommand.some((c) => c.envs?.SIM_CLI_PATH === CLI.path)).toBe(true)
    expect(calls.killed).toBe(false)
    expect(calls.extendLifetime.length).toBeGreaterThan(0)
  })

  it('verifies published deployment tooling before execution on reconnect', async () => {
    const { handle, calls } = fakeSandbox('tooling')
    mockFindSessionSandbox.mockResolvedValue(handle)
    const runCode = handle.runCode.bind(handle)
    handle.runCode = async (code, options) => {
      expect(calls.runCommand.at(-1)?.envs?.SIM_CLI_PATH).toBe(CLI.path)
      expect(calls.runCommand.some(({ envs }) => envs?.SIM_FILE_TARGET === CLI.path)).toBe(true)
      expect(options.envs?.PATH?.split(':')[0]).toBe('/home/user/.sim-cli/release')
      return runCode(code, options)
    }
    await executeInSandbox({ ...CODE_REQUEST, session: { key: 'tooling', cli: CLI } })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('reuses a live session sandbox without creating or killing', async () => {
    const { handle, calls } = fakeSandbox('sb-live')
    mockFindSessionSandbox.mockResolvedValue(handle)

    const result = await executeInSandbox({
      ...CODE_REQUEST,
      sandboxKind: 'mothership',
      session: { key: 'mothership-chat:c1', cli: CLI },
    })

    expect(result.sandboxSession).toBe('reused')
    expect(mockCreate).not.toHaveBeenCalled()
    expect(calls.runCommand.some((c) => c.envs?.SIM_CLI_PATH === CLI.path)).toBe(true)
    expect(calls.killed).toBe(false)
    expect(calls.extendLifetime.length).toBeGreaterThanOrEqual(2)
  })

  it('does not rewrite an unchanged executable while earlier code can still use it', async () => {
    const { handle } = fakeSandbox('unchanged-tooling')
    mockFindSessionSandbox.mockResolvedValue(handle)
    const writes = vi.fn(handle.writeFile.bind(handle))
    handle.writeFile = writes
    const session = {
      key: 'unchanged-tooling',
      cli: CLI,
    }
    await executeInSandbox({ ...CODE_REQUEST, session })
    const firstWrites = writes.mock.calls.length
    await executeInSandbox({ ...CODE_REQUEST, session })
    expect(firstWrites).toBeGreaterThan(0)
    expect(writes).toHaveBeenCalledTimes(firstWrites)
  })

  it('pins shell CLI resolution ahead of caller environment paths', async () => {
    const { handle, calls } = fakeSandbox('shell-cli-path')
    mockFindSessionSandbox.mockResolvedValue(handle)
    await executeShellInSandbox({
      code: 'sim --version',
      envs: { PATH: '/caller/bin' },
      timeoutMs: 10_000,
      session: { key: 'shell-cli-path', cli: CLI },
    })
    expect(calls.runCommand.at(-1)?.envs?.PATH?.split(':').slice(0, 2)).toEqual([
      '/home/user/.sim-cli/release',
      '/home/user/.local/bin',
    ])
  })

  it('prices a reused session call like a Function block sandbox and reports the raw cost', async () => {
    // The copilot bills sandbox time per call: acquire-to-release on the live sandbox,
    // priced at the provider rates, with the raw (unmarked) amount beside the billed one
    // so the worker's settlement applies its multiplier exactly once.
    const { handle } = fakeSandbox('sb-priced')
    slowDown(handle)
    mockFindSessionSandbox.mockResolvedValue(handle)
    const result = await executeInSandbox({
      ...CODE_REQUEST,
      sandboxKind: 'mothership',
      session: { key: 'mothership-chat:c1' },
    })
    expect(result.sandboxSession).toBe('reused')
    expect(result.cost).toBeDefined()
    expect(result.cost?.raw).toBeGreaterThan(0)
    // The billed figure is the raw one times the platform multiplier, rounded; both
    // are present and positive — the worker settles on `raw`, workflows on `total`.
    expect(result.cost?.total).toBeGreaterThan(0)
  })

  it('prices a freshly created session sandbox from its provider request', async () => {
    const { handle } = fakeSandbox('sb-priced-fresh')
    slowDown(handle)
    mockFindSessionSandbox.mockResolvedValue(null)
    mockCreate.mockResolvedValue(handle)
    const result = await executeInSandbox({
      ...CODE_REQUEST,
      sandboxKind: 'mothership',
      session: { key: 'mothership-chat:c2' },
    })
    expect(result.sandboxSession).toBe('created')
    expect(result.cost?.raw).toBeGreaterThan(0)
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
    expect(calls.runCommand[0]?.rootUser).toBe(false)
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

  it('preserves the session identity when its provider lookup fails', async () => {
    mockFindSessionSandbox.mockRejectedValue(new Error('provider listing down'))
    await expect(
      executeInSandbox({
        ...CODE_REQUEST,
        sandboxKind: 'mothership',
        session: { key: 'k' },
      })
    ).rejects.toThrow('provider listing down')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('parallel first calls share one workbench and wait for tooling before executing', async () => {
    const { handle, calls } = fakeSandbox('sb-parallel')
    let installed = false
    let created = false
    let running = 0
    let peak = 0
    mockFindSessionSandbox.mockImplementation(async () => (created ? handle : null))
    mockCreate.mockImplementation(async () => {
      created = true
      return handle
    })
    handle.runCommand = async () => {
      await sleep(2)
      installed = true
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    const runCode = handle.runCode.bind(handle)
    handle.runCode = async (code, options) => {
      expect(installed).toBe(true)
      peak = Math.max(peak, ++running)
      await sleep(60)
      running--
      return runCode(code, options)
    }
    const request = {
      ...CODE_REQUEST,
      session: { key: 'parallel', cli: CLI },
    }
    const results = await Promise.all([executeInSandbox(request), executeInSandbox(request)])
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.sandboxSession).sort()).toEqual(['created', 'reused'])
    expect(calls.runCode).toHaveLength(2)
    expect(peak).toBe(2)
    expect(calls.killed).toBe(false)
  })

  it('an interrupted bootstrap is repaired before a subsequent execution', async () => {
    const { handle, calls } = fakeSandbox('sb-install')
    mockFindSessionSandbox.mockResolvedValue(handle)
    const bootstrap = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'install failed' })
      .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    handle.runCommand = bootstrap
    const request = {
      ...CODE_REQUEST,
      session: { key: 'install', cli: CLI },
    }
    await expect(executeInSandbox(request)).rejects.toThrow('install failed')
    expect(calls.runCode).toHaveLength(0)
    await executeInSandbox(request)
    expect(calls.runCode).toHaveLength(1)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
