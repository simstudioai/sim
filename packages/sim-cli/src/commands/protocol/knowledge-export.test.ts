import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../../runtime/build'
import { attachProtocolCommands } from './index'
import { attachmentFileName } from './knowledge-export'

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

const KB_ID = '4c1b7f60-2d55-4a3e-9c18-70b6ea2f9d31'

let dir: string
let originalCwd: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-kb-export-'))
  originalCwd = process.cwd()
  output.format = 'json'
  requestRaw.mockReset()
})

afterEach(() => {
  process.chdir(originalCwd)
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function zipResponse(fileName?: string): Response {
  return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      ...(fileName ? { 'content-disposition': `attachment; filename="${fileName}"` } : {}),
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

function captureLog(): string[] {
  const logged: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(line))
  return logged
}

async function withStdoutTTY<T>(isTTY: boolean, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: isTTY })
  try {
    return await run()
  } finally {
    if (original) Object.defineProperty(process.stdout, 'isTTY', original)
    else Reflect.deleteProperty(process.stdout, 'isTTY')
  }
}

describe('knowledge export', () => {
  it('saves the bundle to --output-file and prints a machine-readable result', async () => {
    const target = join(dir, 'handbook.simkb.zip')
    requestRaw.mockResolvedValue(zipResponse('Handbook.simkb.zip'))
    const logged = captureLog()

    await program().parseAsync([
      'node',
      'sim',
      'knowledge',
      'export',
      KB_ID,
      '--output-file',
      target,
    ])

    expect(readFileSync(target)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    expect(JSON.parse(logged[0])).toEqual({
      id: KB_ID,
      path: target,
      status: 'saved',
      vectors: true,
    })
    expect(requestRaw).toHaveBeenCalledWith(`/api/v2/knowledge/${KB_ID}/export`, {
      method: 'GET',
      query: { workspaceId: 'ws_local', vectors: true },
    })
  })

  it('refuses to overwrite an existing file without --force', async () => {
    const target = join(dir, 'existing.simkb.zip')
    writeFileSync(target, 'precious')
    requestRaw.mockResolvedValue(zipResponse())

    await expect(
      program().parseAsync(['node', 'sim', 'knowledge', 'export', KB_ID, '-o', target])
    ).rejects.toThrow(/already exists.*--force/s)

    expect(readFileSync(target, 'utf8')).toBe('precious')
  })

  it('overwrites an existing file with --force', async () => {
    const target = join(dir, 'existing.simkb.zip')
    writeFileSync(target, 'old')
    requestRaw.mockResolvedValue(zipResponse())
    captureLog()

    await program().parseAsync([
      'node',
      'sim',
      'knowledge',
      'export',
      KB_ID,
      '-o',
      target,
      '--force',
    ])

    expect(readFileSync(target)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  })

  it('sends vectors=false for --no-vectors and reports it', async () => {
    const target = join(dir, 'lean.simkb.zip')
    requestRaw.mockResolvedValue(zipResponse())
    const logged = captureLog()

    await program().parseAsync([
      'node',
      'sim',
      'knowledge',
      'export',
      KB_ID,
      '-o',
      target,
      '--no-vectors',
    ])

    expect(requestRaw).toHaveBeenCalledWith(`/api/v2/knowledge/${KB_ID}/export`, {
      method: 'GET',
      query: { workspaceId: 'ws_local', vectors: false },
    })
    expect(JSON.parse(logged[0]).vectors).toBe(false)
  })

  it('names the file after Content-Disposition in the current directory by default', async () => {
    process.chdir(dir)
    requestRaw.mockResolvedValue(zipResponse('Refund Policy.simkb.zip'))
    const logged = captureLog()

    await program().parseAsync(['node', 'sim', 'knowledge', 'export', KB_ID])

    const expected = join(process.cwd(), 'Refund Policy.simkb.zip')
    expect(existsSync(expected)).toBe(true)
    expect(JSON.parse(logged[0]).path).toBe(expected)
  })

  it('falls back to the knowledge base id when the server names no file', async () => {
    process.chdir(dir)
    requestRaw.mockResolvedValue(zipResponse())
    captureLog()

    await program().parseAsync(['node', 'sim', 'knowledge', 'export', KB_ID])

    expect(existsSync(join(process.cwd(), `${KB_ID}.simkb.zip`))).toBe(true)
  })

  it('streams raw bytes to stdout for --output-file -', async () => {
    requestRaw.mockResolvedValue(zipResponse('x.simkb.zip'))
    const chunks: Uint8Array[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      return true
    })
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {})

    await withStdoutTTY(false, () =>
      program().parseAsync(['node', 'sim', 'knowledge', 'export', KB_ID, '-o', '-'])
    )

    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    expect(logged).not.toHaveBeenCalled()
  })

  it('refuses to write the zip to an interactive terminal', async () => {
    requestRaw.mockResolvedValue(zipResponse())

    await withStdoutTTY(true, () =>
      expect(
        program().parseAsync(['node', 'sim', 'knowledge', 'export', KB_ID, '-o', '-'])
      ).rejects.toThrow(/Refusing to write application\/zip.*--output-file/s)
    )
  })

  it('rejects --force with the stdout alias before any request', async () => {
    await expect(
      program().parseAsync(['node', 'sim', 'knowledge', 'export', KB_ID, '-o', '-', '--force'])
    ).rejects.toThrow(/--force requires --output-file <path>/)
    expect(requestRaw).not.toHaveBeenCalled()
  })
})

describe('attachmentFileName', () => {
  it('reads the quoted file name', () => {
    expect(attachmentFileName('attachment; filename="Handbook.simkb.zip"')).toBe(
      'Handbook.simkb.zip'
    )
  })

  it('keeps only the base name and ignores a missing or empty header', () => {
    expect(attachmentFileName('attachment; filename="../../etc/passwd"')).toBe('passwd')
    /** The server mangles non-ASCII in the quoted form, so the encoded one wins. */
    expect(
      attachmentFileName(
        `attachment; filename="Suporte t_cnico.simkb.zip"; filename*=UTF-8''${encodeURIComponent('Suporte técnico.simkb.zip')}`
      )
    ).toBe('Suporte técnico.simkb.zip')
    expect(attachmentFileName('attachment; filename="ok.zip"; filename*=UTF-8\'\'%E0%A4%A')).toBe(
      'ok.zip'
    )
    expect(attachmentFileName('attachment; filename=".."')).toBeNull()
    expect(attachmentFileName('attachment')).toBeNull()
    expect(attachmentFileName(null)).toBeNull()
  })
})
