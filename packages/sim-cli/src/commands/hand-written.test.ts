import { createWriteStream, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachHandWritten, streamToFile } from './hand-written.js'

vi.mock('../context.js', () => ({
  clientFrom: () => ({
    client: { request: vi.fn(), requireWorkspace: () => 'ws_local' },
    profile: { workspaceId: 'ws_local', output: 'json', name: 'default', apiKey: 'k' },
  }),
}))

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-dl-'))
})

afterEach(() => {
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

describe('streamToFile', () => {
  it('writes the body to disk', async () => {
    const target = join(dir, 'out.txt')
    await streamToFile(bodyOf(['hello ', 'world']), createWriteStream(target, { flags: 'wx' }))
    expect(existsSync(target)).toBe(true)
  })

  it('refuses to clobber an existing file, naming --force', async () => {
    const target = join(dir, 'out.txt')
    writeFileSync(target, 'precious')
    // The destination usually comes from the server's content-disposition, so a
    // silent truncate could destroy a file the caller never named.
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
      // `end`'s callback receives the flush error; passing `resolve` straight in
      // made that error the resolution value, so a truncated download printed
      // "Saved". /dev/full only errors at flush time, which is the exact path.
      await expect(
        streamToFile(bodyOf(['x'.repeat(64 * 1024)]), createWriteStream('/dev/full'))
      ).rejects.toThrow(/Could not write/)
    }
  )
})

describe('tables import argument guards', () => {
  function importCommand(): Command {
    const root = new Command('sim').exitOverride()
    attachHandWritten(root)
    const walk = (command: Command) => {
      command.exitOverride()
      command.commands.forEach(walk)
    }
    walk(root)
    return root
  }

  async function run(argv: string[]) {
    await importCommand().parseAsync(['node', 'sim', 'tables', 'import', ...argv])
  }

  it('refuses to guess the source', async () => {
    // A new table is a safe default; where the bytes are is not inferable.
    await expect(run([])).rejects.toThrow(/exactly one of <path>/)
    await expect(run(['f.csv', '--file-id', 'w_1'])).rejects.toThrow(/exactly one of <path>/)
  })

  it('rejects existing-table flags when creating one', async () => {
    // Ignoring these would let `--mode replace` read as honoured while a new
    // table is created beside the one it was meant to overwrite.
    await expect(run(['f.csv', '--mode', 'replace'])).rejects.toThrow(/applies to --table-id/)
    await expect(run(['f.csv', '--mapping', '{}'])).rejects.toThrow(/applies to --table-id/)
    await expect(run(['f.csv', '--create-columns', '{}'])).rejects.toThrow(/applies to --table-id/)
  })

  it('rejects new-table flags when importing into an existing one', async () => {
    await expect(run(['f.csv', '--table-id', 't', '--name', 'x'])).rejects.toThrow(
      /--table-id already names the destination/
    )
    await expect(run(['f.csv', '--table-id', 't', '--folder-id', 'f'])).rejects.toThrow(
      /--table-id already names the destination/
    )
  })

  it('asks for a name when there is no file name to take one from', async () => {
    await expect(run(['--file-id', 'w_1'])).rejects.toThrow(/--name <name>/)
  })

  it('checks all of that before touching the filesystem', async () => {
    // `f.csv` does not exist; a "cannot read" error would mean a guard ran late.
    await expect(run(['f.csv', '--mode', 'append'])).rejects.toThrow(/applies to --table-id/)
  })
})
