import { createWriteStream, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../../runtime/build.js'
import { streamToFile } from './files-get.js'
import { attachProtocolCommands } from './index.js'

const { output, requestRaw } = vi.hoisted(() => ({
  output: { format: 'json' },
  requestRaw: vi.fn(),
}))

vi.mock('../../context.js', () => ({
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

function program(): Command {
  const root = new Command('sim').exitOverride()
  for (const group of buildGeneratedCommands()) root.addCommand(group)
  attachProtocolCommands(root)
  return root
}

describe('streamToFile', () => {
  it('writes the body to disk', async () => {
    const target = join(dir, 'out.txt')
    await streamToFile(bodyOf(['hello ', 'world']), createWriteStream(target, { flags: 'wx' }))
    expect(existsSync(target)).toBe(true)
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
    expect(requestRaw).toHaveBeenCalledWith('/api/v2/files/file_1/content', {
      method: 'GET',
      query: { workspaceId: 'ws_local' },
    })
  })

  it('streams raw bytes to stdout with the conventional - destination', async () => {
    requestRaw.mockResolvedValue(new Response('downloaded', { status: 200 }))
    const chunks: Uint8Array[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      return true
    })
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program().parseAsync(['node', 'sim', 'file', 'get', 'file_1', '-o', '-'])

    expect(Buffer.concat(chunks).toString('utf8')).toBe('downloaded')
    expect(logged).not.toHaveBeenCalled()
  })

  it('rejects overwrite semantics for stdout', async () => {
    await expect(
      program().parseAsync(['node', 'sim', 'file', 'get', 'file_1', '-o', '-', '--force'])
    ).rejects.toThrow(/--force cannot be used/)
    expect(requestRaw).not.toHaveBeenCalled()
  })
})
