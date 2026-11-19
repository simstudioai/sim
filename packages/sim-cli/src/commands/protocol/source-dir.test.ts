import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { SOURCE_BASE_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type EmbedContext, embedStore } from '../../embed-context'
import { EmbeddedOutput } from '../../embed-output'
import {
  SOURCE_DIR_LOCK,
  SOURCE_WRITTEN_FILE,
  takeOverStaleLock,
  updateSourceDir,
  withSourceDirLock,
} from './source-dir'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-source-dir-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('updateSourceDir', () => {
  it('keeps the old records when a write stops before every source file landed', async () => {
    const records = [SOURCE_BASE_FILE, SOURCE_LOCK_FILE, SOURCE_WRITTEN_FILE]
    for (const path of records) {
      mkdirSync(join(dir, '.sim'), { recursive: true })
      writeFileSync(join(dir, path), 'old')
    }
    // A folder where the workflow file goes: its rename fails, as a kill mid-write would stop it.
    mkdirSync(join(dir, 'workflow.ts', 'blocked'), { recursive: true })

    await expect(
      updateSourceDir(dir, {
        write: [['workflow.ts', 'new text'], ...records.map((path) => [path, 'new'] as const)],
      })
    ).rejects.toThrow()

    for (const path of records) expect(readFileSync(join(dir, path), 'utf8')).toBe('old')
  })

  it('in an embedded run, writes the records after every file, fetched blobs included', async () => {
    const landed: string[] = []
    const host: EmbedContext = {
      identity: { endpoint: 'http://localhost', apiKey: 'test' },
      stdout: new EmbeddedOutput(),
      stderr: new EmbeddedOutput(),
      writeFile: async (path, content) => {
        await new Response(content).arrayBuffer()
        if (path.endsWith('docs/a.pdf')) throw new Error('interrupted')
        landed.push(path.slice(dir.length + 1))
      },
    }
    const records = [SOURCE_BASE_FILE, SOURCE_WRITTEN_FILE]

    await expect(
      embedStore.run(host, () =>
        updateSourceDir(dir, {
          write: [...records.map((path) => [path, 'new'] as const), ['tables/t.ts', 'text']],
          fetch: [['knowledge/k/docs/a.pdf', async (file) => writeFileSync(file, 'pdf')]],
        })
      )
    ).rejects.toThrow('interrupted')

    expect(landed).toEqual(['tables/t.ts'])
  })
})

describe('withSourceDirLock', () => {
  /** The pid of a process that has exited: an owner a stale lock records. */
  function deadPid(): number {
    const exited = spawnSync(process.execPath, ['-e', '0'])
    if (exited.pid === undefined) throw new Error('No process was started')
    return exited.pid
  }

  function writeOwner(lock: string, pid: number) {
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid, host: hostname() }))
  }

  it('a takeover that found the lock stale before another command replaced it leaves the live lock', async () => {
    const lock = join(dir, SOURCE_DIR_LOCK)
    writeOwner(lock, deadPid())

    // One command takes the stale lock over and runs; the other found the same lock stale before
    // that and only now acts on it.
    const owner = await withSourceDirLock(dir, async () => {
      await takeOverStaleLock(lock)
      return readFileSync(join(lock, 'owner.json'), 'utf8')
    })

    expect(JSON.parse(owner)).toMatchObject({ pid: process.pid })
    expect(existsSync(lock)).toBe(false)
  })

  it('two takeovers of one stale lock: the first removes it, the second finds it gone', async () => {
    const lock = join(dir, SOURCE_DIR_LOCK)
    writeOwner(lock, deadPid())

    await takeOverStaleLock(lock)
    expect(existsSync(lock)).toBe(false)
    await takeOverStaleLock(lock)

    expect(await withSourceDirLock(dir, async () => 'ran')).toBe('ran')
  })

  it('refuses a .sim that is a symbolic link, creating nothing where it points', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'sim-source-dir-outside-'))
    symlinkSync(outside, join(dir, '.sim'))
    let ran = false

    const refused = withSourceDirLock(dir, async () => {
      ran = true
    })

    await expect(refused).rejects.toMatchObject({ code: 'SOURCE_SYMLINK' })
    expect(ran).toBe(false)
    expect(readdirSync(outside)).toEqual([])
    rmSync(outside, { recursive: true, force: true })
  })

  it('refuses a lock that is a symbolic link, never reading or removing what it points at', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'sim-source-dir-outside-'))
    writeOwner(outside, deadPid())
    mkdirSync(join(dir, '.sim'))
    symlinkSync(outside, join(dir, SOURCE_DIR_LOCK))
    let ran = false

    const refused = withSourceDirLock(dir, async () => {
      ran = true
    })

    await expect(refused).rejects.toMatchObject({ code: 'SOURCE_SYMLINK' })
    expect(ran).toBe(false)
    expect(readdirSync(outside)).toEqual(['owner.json'])
    rmSync(outside, { recursive: true, force: true })
  })
})
