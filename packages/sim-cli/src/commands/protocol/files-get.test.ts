import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../../runtime/build'
import {
  isTerminalSafeContentType,
  removeStagingOnSignal,
  saveToFile,
  streamToFile,
} from './files-get'
import { attachProtocolCommands } from './index'

const { output, requestRaw } = vi.hoisted(() => ({
  output: { format: 'json' },
  requestRaw: vi.fn(),
}))

vi.mock('../../context', () => ({
  clientFrom: () => ({
    client: { requestRaw, requireWorkspace: () => 'ws_local' },
    profile: {
      workspaceId: 'ws_local',
      output: output.format,
      name: 'default',
      apiKey: 'k',
      endpoint: 'https://sim.example',
    },
  }),
}))

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-dl-'))
  output.format = 'json'
  requestRaw.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })
}

function failingBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('partial'))
      controller.error(new Error('connection lost'))
    },
  })
}

/** What `fetch` does to a body when the request's own timeout elapses. */
function timedOutBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('partial'))
      controller.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
    },
  })
}

function program(): Command {
  const root = new Command('sim').exitOverride()
  for (const group of buildGeneratedCommands()) root.addCommand(group)
  attachProtocolCommands(root)
  const override = (command: Command) => {
    command.exitOverride()
    command.commands.forEach(override)
  }
  override(root)
  return root
}

describe('an interrupted download', () => {
  /** Staging directories left beside a destination, as `ls -a` shows them. */
  function stagingDirectories(): string[] {
    return readdirSync(dir).filter((entry) => entry.startsWith('.sim-download-'))
  }

  it('removes the staging directory and re-raises when a signal arrives', () => {
    const staging = mkdtempSync(join(dir, '.sim-download-'))
    writeFileSync(join(staging, 'payload'), 'partial')
    // Injected: the real termination re-raises the signal, which would take the
    // test runner down with it.
    const terminate = vi.fn()
    const dispose = removeStagingOnSignal(() => staging, terminate)

    process.emit('SIGINT')
    dispose()

    expect(existsSync(staging)).toBe(false)
    expect(terminate).toHaveBeenCalledWith('SIGINT')
  })

  it('watches for signals only while a download is staged', async () => {
    const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') }
    let observed = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        observed = process.listenerCount('SIGINT')
        controller.enqueue(new TextEncoder().encode('data'))
        controller.close()
      },
    })

    await saveToFile(body, join(dir, 'out.bin'), false)

    expect(observed).toBe(before.int + 1)
    expect(process.listenerCount('SIGINT')).toBe(before.int)
    expect(process.listenerCount('SIGTERM')).toBe(before.term)
  })

  it('disposes the watch when the publish itself fails', async () => {
    const target = join(dir, 'out.txt')
    writeFileSync(target, 'precious')
    const before = process.listenerCount('SIGINT')

    await expect(saveToFile(bodyOf(['new']), target, false)).rejects.toThrow(/already exists/)

    expect(process.listenerCount('SIGINT')).toBe(before)
  })

  it('leaves no staging directory behind on a completed download', async () => {
    await saveToFile(bodyOf(['done']), join(dir, 'out.bin'), false)

    expect(stagingDirectories()).toEqual([])
  })
})

describe('streamToFile', () => {
  it('writes the body to disk', async () => {
    const target = join(dir, 'out.txt')
    await streamToFile(bodyOf(['hello ', 'world']), createWriteStream(target, { flags: 'wx' }))
    expect(existsSync(target)).toBe(true)
  })

  it('reports an elapsed request bound as a timeout, not as a failed write', async () => {
    // The stream is torn down by the request's own timeout, which is not a
    // disk problem: calling it "could not write" sent the reader to check
    // permissions and free space for a bound they can raise.
    const target = join(dir, 'out.txt')
    await expect(
      streamToFile(timedOutBody(), createWriteStream(target, { flags: 'wx' }))
    ).rejects.toThrow(/SIM_TIMEOUT_SECONDS/)
  })

  it('still reports a genuine write failure as one', async () => {
    const target = join(dir, 'out.txt')
    await expect(
      streamToFile(failingBody(), createWriteStream(target, { flags: 'wx' }))
    ).rejects.toThrow(/Could not write/)
  })

  it('refuses to clobber an existing file, naming --force', async () => {
    const target = join(dir, 'out.txt')
    writeFileSync(target, 'precious')
    await expect(
      streamToFile(bodyOf(['new']), createWriteStream(target, { flags: 'wx' }))
    ).rejects.toThrow(/already exists.*--force/s)
  })

  it('overwrites when the caller asked for it', async () => {
    const target = join(dir, 'out.txt')
    writeFileSync(target, 'old')
    await streamToFile(bodyOf(['new']), createWriteStream(target, { flags: 'w' }))
    expect(existsSync(target)).toBe(true)
  })

  it.skipIf(!existsSync('/dev/full'))(
    'rejects when the final flush fails instead of reporting success',
    async () => {
      await expect(
        streamToFile(bodyOf(['x'.repeat(64 * 1024)]), createWriteStream('/dev/full'))
      ).rejects.toThrow(/Could not write/)
    }
  )

  it('cancels the response body and waits for the pump when writing fails', async () => {
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first chunk'))
      },
      cancel: cancelled,
    })
    const target = join(dir, 'out.txt')
    const destination = Object.assign(
      new Writable({
        write(_chunk, _encoding, callback) {
          const error = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
          callback(error)
        },
      }),
      { path: target }
    )

    await expect(streamToFile(body, destination)).rejects.toThrow(
      `Could not write ${target}: disk full`
    )
    expect(cancelled).toHaveBeenCalledOnce()
  })
})

describe('saveToFile', () => {
  it('preserves the original destination when a forced download fails', async () => {
    const target = join(dir, 'out.txt')
    writeFileSync(target, 'precious')

    await expect(saveToFile(failingBody(), target, true)).rejects.toThrow(/connection lost/)

    expect(readFileSync(target, 'utf8')).toBe('precious')
  })

  it('leaves no partial destination when a new download fails', async () => {
    const target = join(dir, 'out.txt')

    await expect(saveToFile(failingBody(), target, false)).rejects.toThrow(/connection lost/)

    expect(existsSync(target)).toBe(false)
  })

  it('preserves an existing destination without --force', async () => {
    const target = join(dir, 'out.txt')
    writeFileSync(target, 'precious')

    await expect(saveToFile(bodyOf(['new']), target, false)).rejects.toThrow(
      /already exists.*--force/s
    )

    expect(readFileSync(target, 'utf8')).toBe('precious')
  })

  it('publishes a completed forced download over the original', async () => {
    const target = join(dir, 'out.txt')
    writeFileSync(target, 'old')

    await saveToFile(bodyOf(['new']), target, true)

    expect(readFileSync(target, 'utf8')).toBe('new')
  })

  it('preserves a forced symlink destination and replaces its target', async () => {
    const target = join(dir, 'target.txt')
    const link = join(dir, 'link.txt')
    writeFileSync(target, 'old')
    symlinkSync(target, link)

    await saveToFile(bodyOf(['new']), link, true)

    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(readFileSync(link, 'utf8')).toBe('new')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
  })

  it('preserves a dangling forced symlink and creates its target', async () => {
    const target = join(dir, 'missing.txt')
    const link = join(dir, 'link.txt')
    symlinkSync('missing.txt', link)

    await saveToFile(bodyOf(['new']), link, true)

    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(readFileSync(link, 'utf8')).toBe('new')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
  })
})

describe('isTerminalSafeContentType', () => {
  it('accepts text formats and rejects binary or unknown formats', () => {
    expect(isTerminalSafeContentType('text/markdown; charset=utf-8')).toBe(true)
    expect(isTerminalSafeContentType('application/problem+json')).toBe(true)
    expect(isTerminalSafeContentType('application/pdf')).toBe(false)
    expect(isTerminalSafeContentType(null)).toBe(false)
  })
})

describe('files get', () => {
  it('prints a normalized machine-readable result', async () => {
    const target = join(dir, 'download.txt')
    requestRaw.mockResolvedValue(new Response('downloaded', { status: 200 }))
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(line))

    await program().parseAsync(['node', 'sim', 'file', 'get', 'file_1', '--output-file', target])

    expect(JSON.parse(logged[0])).toEqual({
      id: 'file_1',
      path: target,
      status: 'saved',
    })
    expect(requestRaw).toHaveBeenCalledWith('/api/v2/files/file_1', {
      method: 'GET',
      query: { workspaceId: 'ws_local' },
    })
  })

  it('streams raw bytes to stdout by default', async () => {
    requestRaw.mockResolvedValue(new Response('downloaded', { status: 200 }))
    const chunks: Uint8Array[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      return true
    })
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program().parseAsync(['node', 'sim', 'file', 'get', 'file_1'])

    expect(Buffer.concat(chunks).toString('utf8')).toBe('downloaded')
    expect(logged).not.toHaveBeenCalled()
  })

  it.each([
    ['without an output path', ['--force']],
    ['with the stdout alias', ['-o', '-', '--force']],
  ])('rejects --force %s', async (_label, args) => {
    await expect(
      program().parseAsync(['node', 'sim', 'file', 'get', 'file_1', ...args])
    ).rejects.toThrow(/--force requires --output-file <path>/)
    expect(requestRaw).not.toHaveBeenCalled()
  })

  it('refuses binary content when stdout is an interactive terminal', async () => {
    requestRaw.mockResolvedValue(
      new Response(new Uint8Array([0, 1, 2]), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      })
    )
    const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })

    try {
      await expect(program().parseAsync(['node', 'sim', 'file', 'get', 'file_1'])).rejects.toThrow(
        /Refusing to write application\/octet-stream.*--output-file/s
      )
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process.stdout, 'isTTY', originalDescriptor)
      } else {
        Reflect.deleteProperty(process.stdout, 'isTTY')
      }
    }
  })

  it('rejects an extra positional rather than reading only the first file', async () => {
    await expect(
      program().parseAsync(['node', 'sim', 'file', 'get', 'file_1', 'file_2'])
    ).rejects.toThrow(/too many arguments/)
    expect(requestRaw).not.toHaveBeenCalled()
  })
})
