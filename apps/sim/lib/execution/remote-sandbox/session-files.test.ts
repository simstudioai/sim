/**
 * @vitest-environment node
 */
import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { lstat, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { find, read, write, writeStream, create, run, remove } = vi.hoisted(() => ({
  find: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  writeStream: vi.fn(),
  create: vi.fn(),
  run: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/lib/execution/remote-sandbox/provider', () => ({
  resolveProvider: () => ({
    id: 'e2b',
    findSessionSandbox: find,
    create,
    resolveLifetimeMs: (ms: number) => ms,
  }),
}))
vi.mock('@/lib/execution/remote-sandbox/session-lock', () => ({
  withSandboxSessionLock: async <T>(
    _key: string,
    signal: AbortSignal,
    action: (signal: AbortSignal) => Promise<T>
  ): Promise<T> => {
    signal.throwIfAborted()
    return action(signal)
  },
}))

import { observeSandboxExecution } from '@/lib/execution/remote-sandbox/execution-observer'
import {
  readSessionSandboxFile,
  writeSessionSandboxFile,
} from '@/lib/execution/remote-sandbox/session-files'
import { runCli } from '@/lib/mothership/agent-cli/run-cli'

describe('workbench file cancellation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    find.mockResolvedValue({
      readFileWithLimit: read,
      writeFile: write,
      writeFileStream: writeStream,
      removeFile: remove,
      runCommand: run,
    })
    read.mockResolvedValue({ content: 'data' })
    write.mockResolvedValue(undefined)
    remove.mockResolvedValue(undefined)
    run.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
  })

  it('does not write if Stop arrives during the sandbox lookup', async () => {
    const controller = new AbortController()
    find.mockImplementation(async () => {
      controller.abort(new Error('Stopped'))
      return { readFileWithLimit: read, writeFile: write }
    })
    expect(
      await writeSessionSandboxFile('chat', 'result.csv', 'bytes', controller.signal)
    ).toMatchObject({
      outcome: 'error',
      detail: 'Stopped',
    })
    expect(write).not.toHaveBeenCalled()
  })

  it.each(['read', 'write'] as const)(
    'checks prior run ownership before workbench %s access',
    async (operation) => {
      const sessionAccess = vi.fn(async () => {
        throw new Error('Earlier work is unresolved')
      })
      const result = await observeSandboxExecution(
        { hold: vi.fn(), unsettled: vi.fn(), sessionAccess },
        () =>
          operation === 'read'
            ? readSessionSandboxFile('chat', 'report.csv')
            : writeSessionSandboxFile('chat', 'report.csv', 'new')
      )
      expect(result).toMatchObject({ outcome: 'error', detail: 'Earlier work is unresolved' })
      expect(find).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
    }
  )

  it('passes cancellation into the bounded read and leaves a different invocation usable', async () => {
    const controller = new AbortController()
    read.mockImplementationOnce(async (_path, options) => {
      controller.abort(new Error('Stopped'))
      expect(options.signal.aborted).toBe(true)
      options.signal.throwIfAborted()
    })
    expect(
      (await readSessionSandboxFile('chat', 'input.csv', 'utf8', controller.signal)).outcome
    ).not.toBe('read')
    expect(await readSessionSandboxFile('chat', 'input.csv')).toEqual({
      outcome: 'read',
      content: 'data',
    })
    expect(read).toHaveBeenLastCalledWith(
      '/home/user/input.csv',
      expect.objectContaining({ maxBytes: 4 * 1024 * 1024 })
    )
  })

  it('does not start provider work for an already-stopped invocation', async () => {
    const stopped = AbortSignal.abort(new Error('Stopped'))
    expect((await writeSessionSandboxFile('chat', 'out', 'bytes', stopped)).outcome).toBe('error')
    expect((await readSessionSandboxFile('chat', 'in', 'utf8', stopped)).outcome).toBe('error')
    expect(find).not.toHaveBeenCalled()
  })

  it('streams a large binary download into staging before publication', async () => {
    let produced = 0
    let received = 0
    const chunk = new Uint8Array(1024 * 1024).fill(255)
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (produced++ < 12) controller.enqueue(chunk)
          else controller.close()
        },
      },
      { highWaterMark: 0 }
    )
    writeStream.mockImplementation(async (_path, stream: ReadableStream<Uint8Array>) => {
      expect(produced).toBeLessThan(3)
      const reader = stream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          expect(Buffer.from(value).equals(chunk)).toBe(true)
          expect(run).not.toHaveBeenCalled()
        }
      } finally {
        reader.releaseLock()
      }
    })
    expect(await writeSessionSandboxFile('chat', 'report.bin', body)).toEqual({
      outcome: 'written',
      path: '/home/user/report.bin',
    })
    expect(received).toBe(12 * 1024 * 1024)
    expect(write).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each(['text', 'binary'] as const)(
    'observes exactly the %s bytes written before publication',
    async (kind) => {
      const content = kind === 'text' ? '保存\n🙂' : new Uint8Array([0, 255, 128, 13, 10])
      const expected = Buffer.from(content)
      const observe = vi.fn((_machine, stream: ReadableStream<Uint8Array>) =>
        stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>())
      )
      writeStream.mockImplementation(async (_path, stream: ReadableStream<Uint8Array>) => {
        expect(Buffer.from(await new Response(stream).arrayBuffer())).toEqual(expected)
        expect(run).not.toHaveBeenCalled()
      })
      expect(
        await writeSessionSandboxFile('chat', 'saved.bin', content, undefined, {
          overwrite: true,
          observe,
        })
      ).toMatchObject({ outcome: 'written' })
      expect(observe).toHaveBeenCalledTimes(1)
      expect(observe.mock.calls[0][0].providerId).toBe('e2b')
      expect(write).not.toHaveBeenCalled()
      expect(run).toHaveBeenCalledTimes(1)
    }
  )

  it('refuses publication and releases the observed stream when receipt persistence fails at EOF', async () => {
    let observed: ReadableStream<Uint8Array> | undefined
    const observe = (_machine: unknown, stream: ReadableStream<Uint8Array>) => {
      observed = stream.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          flush() {
            throw new Error('Receipt storage unavailable')
          },
        })
      )
      return observed
    }
    writeStream.mockImplementation(async (_path, stream: ReadableStream<Uint8Array>) => {
      await new Response(stream).arrayBuffer()
    })
    expect(
      await writeSessionSandboxFile('chat', 'saved.txt', 'data', undefined, {
        overwrite: true,
        observe,
      })
    ).toMatchObject({ outcome: 'error', detail: 'Receipt storage unavailable' })
    expect(observed?.locked).toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it.each(['refused', 'early acknowledgement', 'source failure', 'stopped'])(
    'cancels the streaming source and removes only staging after %s',
    async (failure) => {
      const controller = new AbortController()
      const cancelled = vi.fn()
      const body = new ReadableStream<Uint8Array>(
        {
          pull(source) {
            if (failure === 'source failure') source.error(new Error('Download interrupted'))
            else source.enqueue(new Uint8Array([0, 255, 128]))
          },
          cancel: cancelled,
        },
        { highWaterMark: 0 }
      )
      writeStream.mockImplementation(async (_path, stream: ReadableStream<Uint8Array>) => {
        if (failure === 'refused') throw new Error('Write refused')
        if (failure === 'early acknowledgement') return
        if (failure === 'stopped') controller.abort(new Error('Stopped'))
        await new Response(stream).arrayBuffer()
      })
      expect(
        await writeSessionSandboxFile('chat', 'report.bin', body, controller.signal)
      ).toMatchObject({ outcome: 'error' })
      expect(body.locked).toBe(false)
      expect(run).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      expect(remove).toHaveBeenCalledExactlyOnceWith(writeStream.mock.calls[0][0])
      if (failure !== 'source failure') expect(cancelled).toHaveBeenCalledTimes(1)
    }
  )

  it('cancels a pending source read immediately on Stop', async () => {
    const controller = new AbortController()
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    writeStream.mockImplementation(async (_path, stream: ReadableStream<Uint8Array>) => {
      const consume = new Response(stream).arrayBuffer()
      controller.abort(new Error('Stopped'))
      await consume
    })
    expect(
      await writeSessionSandboxFile('chat', 'report.bin', body, controller.signal)
    ).toMatchObject({ outcome: 'error', detail: 'Stopped' })
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(body.locked).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('enforces the workspace file ceiling cumulatively without buffering the file', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    const cancelled = vi.fn()
    let received = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk)
      },
      cancel: cancelled,
    })
    writeStream.mockImplementation(async (_path, stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
        }
      } finally {
        reader.releaseLock()
      }
    })
    expect(await writeSessionSandboxFile('chat', 'large.bin', body)).toMatchObject({
      outcome: 'error',
      detail: expect.stringContaining('exceeds maximum size'),
    })
    expect(received).toBe(5 * 1024 * 1024 * 1024)
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it.each(['stop', 'lost acknowledgement'])(
    'cleans its staged bytes after %s during upload',
    async (failure) => {
      const controller = new AbortController()
      const files = new Map<string, string>([
        ['/home/user/report.txt', 'original'],
        ['/home/user/.sim-write-other-job', 'other job'],
      ])
      write.mockImplementation(async (path: string, content: string) => {
        files.set(path, content)
        if (failure === 'stop') controller.abort(new Error('Stopped'))
        else throw new Error('Upload acknowledgement lost')
      })
      remove.mockImplementation(async (path: string) => {
        files.delete(path)
      })
      expect(
        await writeSessionSandboxFile('chat', 'report.txt', 'new', controller.signal)
      ).toMatchObject({ outcome: 'error' })
      expect(run).not.toHaveBeenCalled()
      expect(remove).toHaveBeenCalledExactlyOnceWith(write.mock.calls[0][0])
      expect([...files.entries()]).toEqual([
        ['/home/user/report.txt', 'original'],
        ['/home/user/.sim-write-other-job', 'other job'],
      ])
    }
  )

  it('creates a workbench on the first write but never for a missing-file read', async () => {
    find.mockResolvedValue(null)
    create.mockResolvedValue({
      sandboxId: 'fresh',
      writeFile: write,
      removeFile: remove,
      runCommand: run,
    })
    expect(await readSessionSandboxFile('chat', 'missing')).toEqual({ outcome: 'no-session' })
    expect(create).not.toHaveBeenCalled()
    expect(await writeSessionSandboxFile('chat', 'input.csv', 'rows')).toEqual({
      outcome: 'written',
      path: '/home/user/input.csv',
    })
    expect(create).toHaveBeenCalledExactlyOnceWith(
      'mothership',
      expect.objectContaining({
        sessionKey: 'chat',
        lifetimeMs: 20 * 60_000,
      })
    )
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/^\/home\/user\/\.sim-write-/), 'rows')
    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        envs: expect.objectContaining({ SIM_FILE_TARGET: '/home/user/input.csv' }),
        atMostOnce: true,
        rootUser: false,
      })
    )
  })

  it('never replaces the workbench on a lookup error or starts one for an invalid path', async () => {
    find.mockRejectedValue(new Error('provider temporarily unavailable'))
    expect(await writeSessionSandboxFile('chat', 'output', 'rows')).toMatchObject({
      outcome: 'error',
      detail: 'provider temporarily unavailable',
    })
    expect(create).not.toHaveBeenCalled()
    find.mockClear()
    expect((await writeSessionSandboxFile('chat', '', 'rows')).outcome).toBe('error')
    expect(find).not.toHaveBeenCalled()
  })

  it('publishes complete bytes with atomic no-clobber, force and literal path semantics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mship-file-publish-'))
    const exec = promisify(execFile)
    write.mockImplementation(async (path: string, content: string | ArrayBuffer) => {
      await writeFile(path, typeof content === 'string' ? content : new Uint8Array(content))
    })
    writeStream.mockImplementation(async (path, body, options) => {
      await pipeline(Readable.fromWeb(body), createWriteStream(path), { signal: options.signal })
    })
    remove.mockImplementation(async (path: string) => {
      await rm(path, { force: true })
    })
    run.mockImplementation(async (command, options) => {
      try {
        const result = await exec('/bin/sh', ['-c', command], {
          env: { ...process.env, ...options.envs },
          signal: options.signal,
        })
        return { ...result, exitCode: 0 }
      } catch (error) {
        return { stdout: '', stderr: getErrorMessage(error), exitCode: 1 }
      }
    })
    try {
      const name = 'input "$(touch PWNED)".bin'
      const target = join(directory, name)
      const bytes = Uint8Array.from([0, 255, 137, 128, 65])
      const results = await Promise.all([
        writeSessionSandboxFile('writer-a', target, bytes, undefined, { overwrite: false }),
        writeSessionSandboxFile('writer-b', target, bytes, undefined, { overwrite: false }),
      ])
      expect(results.map((result) => result.outcome).sort()).toEqual(['error', 'written'])
      expect(await readFile(target)).toEqual(Buffer.from(bytes))
      expect(await readdir(directory)).toEqual([name])
      const link = join(directory, 'link.bin')
      await symlink(target, link)
      expect(
        (await writeSessionSandboxFile('writer', link, 'new', undefined, { overwrite: false }))
          .outcome
      ).toBe('error')
      expect(
        (await writeSessionSandboxFile('writer', link, 'new', undefined, { overwrite: true }))
          .outcome
      ).toBe('written')
      expect(await readFile(link, 'utf8')).toBe('new')
      expect(await readFile(target, 'utf8')).toBe('new')
      expect((await lstat(link)).isSymbolicLink()).toBe(true)

      const large = new Uint8Array(6 * 1024 * 1024 + 7).fill(255)
      const identity = {
        endpoint: 'https://sim.test',
        apiKey: 'fixture',
        workspaceId: 'workspace',
        transport: async () => new Response(new Blob([large]).stream()),
      }
      const streamedTarget = join(directory, 'CLI "$(touch PWNED)".bin')
      const args = ['files', 'get', 'file', '-o', streamedTarget]
      const result = await runCli(args, identity, 'chat')
      expect(result, result.stderr).toMatchObject({ exitCode: 0 })
      expect(JSON.parse(result.stdout)).toMatchObject({ path: streamedTarget, status: 'saved' })
      expect((await readFile(streamedTarget)).equals(large)).toBe(true)
      expect((await runCli(args, identity, 'chat')).exitCode).toBe(1)
      expect((await readFile(streamedTarget)).equals(large)).toBe(true)
      expect((await runCli([...args, '--force'], identity, 'chat')).exitCode).toBe(0)
      expect((await readFile(streamedTarget)).equals(large)).toBe(true)
      expect((await readdir(directory)).sort()).toEqual(
        [name, 'link.bin', 'CLI "$(touch PWNED)".bin'].sort()
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
