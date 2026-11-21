import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** What each installed interrupt release would remove, read when the signal arrives. */
const signalTargets: Array<() => string | null> = []

vi.mock('./files-get', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./files-get')>()
  return {
    ...actual,
    removeStagingOnSignal: (target: () => string | null) => {
      signalTargets.push(target)
      return actual.removeStagingOnSignal(target)
    },
  }
})

const { withSourceDirLock, SOURCE_DIR_LOCK } = await import('./source-dir')

let dir: string

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'sim-source-lock-release-')))
  signalTargets.length = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the interrupt release of a directory lock', () => {
  it('targets the lock while the command holds it', async () => {
    let held: string | null = null
    await withSourceDirLock(dir, async () => {
      held = signalTargets[0]?.() ?? null
    })

    expect(held).toBe(join(dir, SOURCE_DIR_LOCK))
  })

  it('targets nothing once the command removed its lock, so an interrupt during the rest of its cleanup leaves the next command’s lock', async () => {
    await withSourceDirLock(join(dir, 'out/a'), async () => {})
    const next = join(dir, 'out/a', SOURCE_DIR_LOCK)
    mkdirSync(next, { recursive: true })

    expect(signalTargets[0]?.()).toBeNull()
    writeFileSync(join(next, 'owner.json'), JSON.stringify({ pid: process.pid + 1, host: 'other' }))
    expect(signalTargets[0]?.()).toBeNull()
    expect(existsSync(next)).toBe(true)
  })

  it('targets nothing when the lock at the path names another command', async () => {
    let target: string | null = 'unread'
    await withSourceDirLock(dir, async () => {
      writeFileSync(
        join(dir, SOURCE_DIR_LOCK, 'owner.json'),
        JSON.stringify({ pid: process.pid + 1, host: 'other' })
      )
      target = signalTargets[0]?.() ?? null
    })

    expect(target).toBeNull()
  })
  it('uninstalls the interrupt release even when removing the lock fails', async () => {
    const listening = process.listenerCount('SIGINT')
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'sim-source-lock-outside-')))

    const failed = withSourceDirLock(dir, async () => {
      rmSync(join(dir, SOURCE_DIR_LOCK), { recursive: true, force: true })
      symlinkSync(outside, join(dir, SOURCE_DIR_LOCK))
    })

    await expect(failed).rejects.toMatchObject({ code: 'SOURCE_SYMLINK' })
    expect(process.listenerCount('SIGINT')).toBe(listening)
    rmSync(outside, { recursive: true, force: true })
  })
})
