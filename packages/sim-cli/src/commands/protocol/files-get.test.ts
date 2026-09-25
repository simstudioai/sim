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
import { sleep } from '../../helpers'
import { buildGeneratedCommands } from '../../runtime/build'
import { removeStagingOnSignal, saveToFile, streamToFile } from './files-get'
import { attachProtocolCommands } from './index'

const { output, requestRaw, requireWorkspace } = vi.hoisted(() => ({
  output: { format: 'json' },
  requestRaw: vi.fn(),
  requireWorkspace: vi.fn(() => 'ws_local'),
}))

vi.mock('../../context', () => ({
  clientFrom: () => ({
    client: { requestRaw, requireWorkspace },
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
  requireWorkspace.mockReset().mockReturnValue('ws_local')
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
function _timedOutBody(): ReadableStream<Uint8Array> {
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

  /** Resolves once the download has staged its directory beside the target. */
  async function _stagingDirectory(): Promise<string> {
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const [staged] = stagingDirectories()
      if (staged) return join(dir, staged)
      await sleep(1)
    }
    throw new Error('the download staged no directory')
  }
})

describe('streamToFile', () => {
  it('refuses to clobber an existing file, naming --force', async () => {
    const target = join(dir, 'out.txt')
    writeFileSync(target, 'precious')
    await expect(
      streamToFile(bodyOf(['new']), createWriteStream(target, { flags: 'wx' }))
    ).rejects.toThrow(/already exists.*--force/s)
  })

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
})

describe('files get', () => {
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
})

describe('tool and workflow descriptor downloads', () => {
  it.each([
    {
      command: ['tools', 'files', 'download', 'copilot/abc/report.pdf'],
      fileId: 'copilot/abc/report.pdf',
      path: '/api/v2/tools/files/download',
      query: { workspaceId: 'ws_local', fileId: 'copilot/abc/report.pdf' },
      workspace: true,
    },
    {
      command: [
        'workflows',
        'runs',
        'files',
        'download',
        'wf_1',
        'run_1',
        'execution/ws/run/report.pdf',
      ],
      fileId: 'execution/ws/run/report.pdf',
      path: '/api/v2/workflows/wf_1/runs/run_1/files/execution%2Fws%2Frun%2Freport.pdf',
      query: {},
      workspace: false,
    },
  ])(
    'saves $command bytes and reports the local path',
    async ({ command, fileId, path, query, workspace }) => {
      const target = join(dir, 'report.pdf')
      const bytes = new Uint8Array([0, 255, 13, 10, 42])
      requestRaw.mockResolvedValue(
        new Response(bytes, { headers: { 'content-type': 'application/pdf' } })
      )
      const logged = vi.spyOn(console, 'log').mockImplementation(() => {})
      await program().parseAsync(['node', 'sim', ...command, '-o', target])
      expect(readFileSync(target)).toEqual(Buffer.from(bytes))
      expect(requestRaw).toHaveBeenCalledWith(path, { method: 'GET', query })
      expect(requireWorkspace).toHaveBeenCalledTimes(workspace ? 1 : 0)
      expect(JSON.parse(logged.mock.calls[0][0])).toEqual({
        id: fileId,
        path: target,
        status: 'saved',
      })
    }
  )

  it('preserves an existing local destination unless --force is explicit', async () => {
    const target = join(dir, 'report.pdf')
    writeFileSync(target, 'existing')
    requestRaw.mockResolvedValue(
      new Response('replacement', { headers: { 'content-type': 'application/pdf' } })
    )
    await expect(
      program().parseAsync([
        'node',
        'sim',
        'tools',
        'files',
        'download',
        'copilot/abc/report.pdf',
        '-o',
        target,
      ])
    ).rejects.toThrow(/already exists/)
    expect(readFileSync(target, 'utf8')).toBe('existing')
  })
})
