/** @vitest-environment node */
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { getErrorMessage } from '@sim/utils/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { find, run, read, readStream, remove, lease } = vi.hoisted(() => ({
  find: vi.fn(),
  run: vi.fn(),
  read: vi.fn(),
  readStream: vi.fn(),
  remove: vi.fn(),
  lease: { failAfterAction: false },
}))
vi.mock('@/lib/execution/remote-sandbox/provider', () => ({
  resolveProvider: () => ({ id: 'e2b', findSessionSandbox: find }),
}))
vi.mock('@/lib/execution/remote-sandbox/session-lock', () => ({
  withSandboxSessionLock: async <T>(
    _key: string,
    signal: AbortSignal,
    action: (signal: AbortSignal) => Promise<T>
  ): Promise<T> => {
    signal.throwIfAborted()
    const result = await action(signal)
    if (lease.failAfterAction) throw new Error('Lease lost after snapshot preparation')
    return result
  },
}))

import { observeSandboxExecution } from '@/lib/execution/remote-sandbox/execution-observer'
import { runCli } from '@/lib/mothership/agent-cli/run-cli'

const IDENTITY = { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'workspace' }
let directory: string

beforeEach(async () => {
  vi.resetAllMocks()
  lease.failAfterAction = false
  directory = await mkdtemp(join(tmpdir(), 'mship-upload-'))
  const exec = promisify(execFile)
  read.mockImplementation(async (path, options) => {
    const size = (await stat(path)).size
    if (size > options.maxBytes) throw new Error(`File exceeds ${options.maxBytes} bytes`)
    return { content: (await readFile(path)).toString(options.encoding), byteLength: size }
  })
  readStream.mockImplementation(async (path, options) =>
    Readable.toWeb(createReadStream(path, { signal: options.signal }))
  )
  remove.mockImplementation(async (path) => rm(path, { force: true }))
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
  find.mockResolvedValue({
    readFileWithLimit: read,
    readFileStream: readStream,
    getFileSize: async (path: string) => (await stat(path)).size,
    removeFile: remove,
    runCommand: run,
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})

describe('workbench upload composition', () => {
  it('uploads a generated file larger than the argument read cap from one byte snapshot', async () => {
    const bytes = new Uint8Array(6 * 1024 * 1024 + 7).fill(255)
    const path = join(directory, 'report "$(touch PWNED)".bin')
    await writeFile(path, bytes)
    const requests: Request[] = []
    const transport = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.url.includes('/complete?')) {
        expect(remove).toHaveBeenCalledTimes(1)
        await expect(stat(remove.mock.calls[0][0])).rejects.toMatchObject({ code: 'ENOENT' })
        return Response.json({ data: { file: { id: 'file', name: 'report.bin' } } })
      }
      expect(JSON.parse(await request.text()).size).toBe(bytes.length)
      await writeFile(path, 'later code changed the original')
      return Response.json({
        data: {
          session: { id: 'upload' },
          uploadToken: 'fixture',
          transfer: { method: 'put', url: 'https://upload.test/data', headers: {} },
        },
      })
    }
    const upload = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(ReadableStream)
      const received = Buffer.from(await new Request(input, init).arrayBuffer())
      expect(received.equals(bytes)).toBe(true)
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', upload)
    const result = await runCli(['files', 'upload', path], { ...IDENTITY, transport }, 'chat')
    expect(result, result.stderr).toMatchObject({ exitCode: 0 })
    expect(requests).toHaveLength(2)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(read).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual(['report "$(touch PWNED)".bin'])
    expect(await readFile(path, 'utf8')).toBe('later code changed the original')
    expect(remove).toHaveBeenCalledTimes(1)
    await expect(stat(remove.mock.calls[0][0])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['files', 'tables', 'knowledge'])(
    'streams multipart %s uploads using the existing control protocol',
    async (kind) => {
      const bytes = new Uint8Array(9 * 1024 * 1024 + 17)
      for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251
      const path = join(directory, 'generated.csv')
      await writeFile(path, bytes)
      const partSize = 8 * 1024 * 1024
      const uploaded: number[] = []
      const transport = async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init)
        if (request.url.includes('/complete?')) {
          expect(uploaded).toEqual([1, 2])
          return Response.json({
            data:
              kind === 'tables'
                ? { id: 'job', status: 'completed', tableId: 'table', rowsProcessed: 3 }
                : kind === 'knowledge'
                  ? {
                      document: {
                        id: 'document',
                        filename: 'generated.csv',
                        fileSize: bytes.length,
                      },
                    }
                  : { file: { id: 'file', name: 'generated.csv' } },
          })
        }
        const body = JSON.parse(await request.text())
        if (request.url.includes('/parts?')) {
          expect(body.partNumbers).toEqual([1, 2])
          return Response.json({
            data: {
              parts: [2, 1].map((partNumber) => ({
                partNumber,
                url: `https://upload.test/${partNumber}`,
                headers: { 'content-type': 'application/octet-stream' },
              })),
            },
          })
        }
        expect(kind === 'tables' ? body.source.size : body.size).toBe(bytes.length)
        await writeFile(path, 'modified after snapshot')
        return Response.json({
          data: {
            session: { id: 'job', status: 'uploading' },
            uploadToken: 'fixture',
            transfer: { method: 'multipart', partSize, partCount: 2 },
          },
        })
      }
      vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init)
        const part = Number(new URL(request.url).pathname.slice(1))
        const expected = bytes.subarray(
          (part - 1) * partSize,
          Math.min(part * partSize, bytes.length)
        )
        expect(init?.body).toBeInstanceOf(ReadableStream)
        expect(request.headers.get('content-length')).toBe(String(expected.length))
        expect(request.headers.has('authorization')).toBe(false)
        expect(Buffer.from(await request.arrayBuffer()).equals(expected)).toBe(true)
        uploaded.push(part)
        return new Response(null, { status: 200 })
      })
      const args =
        kind === 'tables'
          ? ['tables', 'import', path, '--name', 'Imported', '--no-wait']
          : kind === 'knowledge'
            ? ['knowledge', 'documents', 'upload', 'base', path]
            : ['files', 'upload', path]
      const result = await runCli(args, { ...IDENTITY, transport }, 'chat')
      expect(result, result.stderr).toMatchObject({ exitCode: 0 })
      expect(uploaded).toEqual([1, 2])
      expect(read).not.toHaveBeenCalled()
      expect(readStream).toHaveBeenCalledTimes(1)
      expect(remove).toHaveBeenCalledTimes(1)
      await expect(stat(remove.mock.calls[0][0])).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(path, 'utf8')).toBe('modified after snapshot')
    }
  )

  it('cleans the upload session after Stop with a separate cancellation signal', async () => {
    const controller = new AbortController()
    const path = join(directory, 'rows.csv')
    await writeFile(path, 'name\nAda\n')
    const cancelled = vi.fn()
    readStream.mockImplementationOnce(
      async () => new ReadableStream<Uint8Array>({ cancel: cancelled })
    )
    const requests: string[] = []
    const transport = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request.method)
      if (request.method === 'DELETE') {
        expect(controller.signal.aborted).toBe(true)
        expect(request.signal.aborted).toBe(false)
        return Response.json({ data: { status: 'aborted' } })
      }
      return Response.json({
        data: {
          session: { id: 'upload' },
          uploadToken: 'fixture',
          transfer: { method: 'put', url: 'https://upload.test/data', headers: {} },
        },
      })
    }
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const consumption = new Request(input, init).arrayBuffer()
      controller.abort(new Error('Stopped'))
      await consumption
      throw new Error('Cancelled upload must not succeed')
    })
    const result = await runCli(
      ['files', 'upload', path],
      { ...IDENTITY, transport, signal: controller.signal },
      'chat'
    )
    expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('Stopped') })
    expect(requests).toEqual(['POST', 'DELETE'])
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
    await expect(stat(remove.mock.calls[0][0])).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path, 'utf8')).toBe('name\nAda\n')
  })

  it.each([
    'empty',
    'missing',
    'directory',
    'too large',
    'lease lost',
    'invalid mapping',
    'API refusal',
  ])('leaves no snapshot after %s', async (failure) => {
    const path = join(directory, 'input.csv')
    if (failure !== 'missing') await writeFile(path, failure === 'empty' ? '' : 'name\nAda\n')
    if (failure === 'too large') await truncate(path, 5 * 1024 * 1024 * 1024 + 1)
    lease.failAfterAction = failure === 'lease lost'
    const transport = vi.fn(async () =>
      Response.json({ message: 'Access denied' }, { status: 403 })
    )
    const args =
      failure === 'invalid mapping'
        ? ['tables', 'import', path, '--table-id', 'table', '--mapping', '{invalid}']
        : ['files', 'upload', failure === 'directory' ? directory : path]
    const result = await runCli(args, { ...IDENTITY, transport }, 'chat')
    expect(result).toMatchObject({ exitCode: 1 })
    expect(transport).toHaveBeenCalledTimes(failure === 'API refusal' ? 1 : 0)
    expect(readStream).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledTimes(1)
    await expect(stat(remove.mock.calls[0][0])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('checks prior execution ownership before snapshot preparation', async () => {
    const result = await observeSandboxExecution(
      {
        hold: vi.fn(),
        unsettled: vi.fn(),
        sessionAccess: async () => {
          throw new Error('Earlier work remains unresolved')
        },
      },
      () => runCli(['files', 'upload', 'input.csv'], IDENTITY, 'chat')
    )
    expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('Earlier work') })
    expect(find).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
})
