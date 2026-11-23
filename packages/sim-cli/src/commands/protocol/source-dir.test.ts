import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { SOURCE_BASE_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type EmbedContext, embedStore } from '../../embed-context'
import { EmbeddedOutput } from '../../embed-output'
import {
  readSourceText,
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

  it('in an embedded run, a read the run stopped during throws instead of reading as a missing file', async () => {
    const stopped = new AbortController()
    const host: EmbedContext = {
      identity: { endpoint: 'http://localhost', apiKey: 'test', signal: stopped.signal },
      stdout: new EmbeddedOutput(),
      stderr: new EmbeddedOutput(),
      readFile: async () => {
        stopped.abort()
        return 'text'
      },
    }

    await expect(embedStore.run(host, () => readSourceText(dir, 'workflow.ts'))).rejects.toThrow()
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
    const seen = statSync(lock)

    // One command takes the stale lock over and runs; the other found the same lock stale before
    // that and only now acts on it.
    const owner = await withSourceDirLock(dir, async () => {
      await takeOverStaleLock(lock, seen)
      return readFileSync(join(lock, 'owner.json'), 'utf8')
    })

    expect(JSON.parse(owner)).toMatchObject({ pid: process.pid })
    expect(existsSync(lock)).toBe(false)
  })

  it('two takeovers of one stale lock: the first removes it, the second finds it gone', async () => {
    const lock = join(dir, SOURCE_DIR_LOCK)
    writeOwner(lock, deadPid())
    const seen = statSync(lock)

    await takeOverStaleLock(lock, seen)
    expect(existsSync(lock)).toBe(false)
    await takeOverStaleLock(lock, seen)

    expect(await withSourceDirLock(dir, async () => 'ran')).toBe('ran')
  })

  it.each([
    ['no owner file', undefined],
    ['an empty owner file', ''],
    ['an owner file cut short', '{"pid": 12'],
  ])('takes over a lock whose command died before recording its owner: %s', async (_, owner) => {
    const lock = join(dir, SOURCE_DIR_LOCK)
    mkdirSync(lock, { recursive: true })
    if (owner !== undefined) writeFileSync(join(lock, 'owner.json'), owner)
    const twoMinutesAgo = Date.now() / 1000 - 120
    utimesSync(lock, twoMinutesAgo, twoMinutesAgo)

    expect(await withSourceDirLock(dir, async () => 'ran')).toBe('ran')
    expect(existsSync(lock)).toBe(false)
  })

  it('refuses as busy a fresh lock whose owner is still being written', async () => {
    const lock = join(dir, SOURCE_DIR_LOCK)
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'owner.json'), '')

    await expect(withSourceDirLock(dir, async () => 'ran')).rejects.toMatchObject({
      code: 'SOURCE_DIR_BUSY',
    })
    expect(existsSync(join(lock, 'owner.json'))).toBe(true)
  })

  it('a failed command on a missing nested directory leaves none of the folders the lock created', async () => {
    mkdirSync(join(dir, 'out'))
    writeFileSync(join(dir, 'out', 'kept.txt'), 'kept')

    await expect(
      withSourceDirLock(join(dir, 'out', 'a', 'b'), async () => {
        throw new Error('not found')
      })
    ).rejects.toThrow('not found')

    expect(existsSync(join(dir, 'out', 'a'))).toBe(false)
    expect(readFileSync(join(dir, 'out', 'kept.txt'), 'utf8')).toBe('kept')
  })

  it('keeps an empty folder that was there before the lock created the ones under it', async () => {
    mkdirSync(join(dir, 'out'))

    expect(await withSourceDirLock(join(dir, 'out', 'a', 'b'), async () => 'ran')).toBe('ran')

    expect(existsSync(join(dir, 'out', 'a'))).toBe(false)
    expect(existsSync(join(dir, 'out'))).toBe(true)
  })

  it('removes the folders it created and keeps an empty one it did not, through a path holding ..', async () => {
    mkdirSync(join(dir, 'ws', 'a', 'keep'), { recursive: true })

    expect(
      await withSourceDirLock(`${join(dir, 'ws', 'a', 'new')}/../keep/leaf`, async () => 'ran')
    ).toBe('ran')

    expect(existsSync(join(dir, 'ws', 'a', 'keep'))).toBe(true)
    expect(existsSync(join(dir, 'ws', 'a', 'keep', 'leaf'))).toBe(false)
    expect(existsSync(join(dir, 'ws', 'a', 'new'))).toBe(false)
  })

  it('releases the lock when an interrupt ends the command holding it', () => {
    const script = `
      import { withSourceDirLock } from ${JSON.stringify(join(import.meta.dirname, 'source-dir/index.ts'))}
      await withSourceDirLock(process.env.SOURCE_DIR, async () => {
        process.kill(process.pid, 'SIGINT')
        await new Promise(() => {})
      })
    `
    const interrupted = spawnSync('bun', ['-e', script], {
      env: { ...process.env, SOURCE_DIR: dir },
      timeout: 20_000,
    })

    expect(interrupted.signal).toBe('SIGINT')
    expect(existsSync(join(dir, '.sim'))).toBe(true)
    expect(existsSync(join(dir, SOURCE_DIR_LOCK))).toBe(false)
  })

  /**
   * The shape of `workspaces source apply`: the commit and its write-back run deferred inside the
   * directory lock, whose own interrupt handler must wait for them too.
   */
  function deferredWriteScript(interrupts: number): string {
    return `
      import { writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { setTimeout as sleep } from 'node:timers/promises'
      import { withSourceDirLock } from ${JSON.stringify(join(import.meta.dirname, 'source-dir/index.ts'))}
      import { deferInterrupts } from ${JSON.stringify(join(import.meta.dirname, '../../terminal/interrupts.ts'))}
      await withSourceDirLock(process.env.SOURCE_DIR, async () => {
        await deferInterrupts(
          async () => {
            for (let sent = 0; sent < ${interrupts}; sent += 1) {
              process.kill(process.pid, 'SIGINT')
              await sleep(50)
            }
            await sleep(300)
            writeFileSync(join(process.env.SOURCE_DIR, 'saved'), 'yes')
          },
          { waiting: 'Waiting for the write.', abandoned: 'Stopped before the write answered.' }
        )
        await new Promise(() => {})
      })
    `
  }

  it('finishes a deferred write at an interrupt, then releases the lock and ends with the signal', () => {
    const interrupted = spawnSync('bun', ['-e', deferredWriteScript(1)], {
      env: { ...process.env, SOURCE_DIR: dir },
      timeout: 20_000,
    })

    expect(interrupted.signal).toBe('SIGINT')
    expect(interrupted.stderr.toString()).toContain('Waiting for the write.')
    expect(existsSync(join(dir, 'saved'))).toBe(true)
    expect(existsSync(join(dir, SOURCE_DIR_LOCK))).toBe(false)
  })

  it('abandons a deferred write at a second interrupt, saying so, and releases the lock', () => {
    const interrupted = spawnSync('bun', ['-e', deferredWriteScript(2)], {
      env: { ...process.env, SOURCE_DIR: dir },
      timeout: 20_000,
    })

    expect(interrupted.signal).toBe('SIGINT')
    expect(interrupted.stderr.toString()).toContain('Stopped before the write answered.')
    expect(existsSync(join(dir, 'saved'))).toBe(false)
    expect(existsSync(join(dir, SOURCE_DIR_LOCK))).toBe(false)
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
