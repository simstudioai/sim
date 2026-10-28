import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function _captureLog(): string[] {
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
  it('refuses to overwrite an existing file without --force', async () => {
    const target = join(dir, 'existing.simkb.zip')
    writeFileSync(target, 'precious')
    requestRaw.mockResolvedValue(zipResponse())

    await expect(
      program().parseAsync(['node', 'sim', 'knowledge', 'export', KB_ID, '-o', target])
    ).rejects.toThrow(/already exists.*--force/s)

    expect(readFileSync(target, 'utf8')).toBe('precious')
  })

  it('refuses to write the zip to an interactive terminal', async () => {
    requestRaw.mockResolvedValue(zipResponse())

    await withStdoutTTY(true, () =>
      expect(
        program().parseAsync(['node', 'sim', 'knowledge', 'export', KB_ID, '-o', '-'])
      ).rejects.toThrow(/Refusing to write application\/zip.*--output-file/s)
    )
  })
})

describe('attachmentFileName', () => {
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
