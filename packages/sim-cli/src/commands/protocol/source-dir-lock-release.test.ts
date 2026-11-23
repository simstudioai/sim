import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Each installed interrupt release: what it would remove, and whether the lock was there when it was uninstalled. */
const releases: Array<{ target: () => string | null; lockAtDispose?: boolean }> = []
let lockPath = ''

vi.mock('./files-get', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./files-get')>()
  return {
    ...actual,
    removeStagingOnSignal: (target: () => string | null) => {
      const release: (typeof releases)[number] = { target }
      releases.push(release)
      const dispose = actual.removeStagingOnSignal(target)
      return () => {
        release.lockAtDispose = existsSync(lockPath)
        dispose()
      }
    },
  }
})

const { withSourceDirLock, SOURCE_DIR_LOCK } = await import('./source-dir')

let dir: string

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'sim-source-lock-release-')))
  lockPath = join(dir, SOURCE_DIR_LOCK)
  releases.length = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the interrupt release of a directory lock', () => {
  it('targets the lock while the command holds it', async () => {
    let held: string | null = null
    await withSourceDirLock(dir, async () => {
      held = releases[0]?.target() ?? null
    })

    expect(held).toBe(lockPath)
  })

  it('is uninstalled only once the lock is gone, so it never outlives the lock it removes', async () => {
    await withSourceDirLock(dir, async () => {})

    expect(releases).toHaveLength(1)
    expect(releases[0].lockAtDispose).toBe(false)
  })

  it('is uninstalled even when removing the lock fails', async () => {
    const listening = process.listenerCount('SIGINT')
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'sim-source-lock-outside-')))

    const failed = withSourceDirLock(dir, async () => {
      rmSync(lockPath, { recursive: true, force: true })
      symlinkSync(outside, lockPath)
    })

    await expect(failed).rejects.toMatchObject({ code: 'SOURCE_SYMLINK' })
    expect(process.listenerCount('SIGINT')).toBe(listening)
    rmSync(outside, { recursive: true, force: true })
  })
})
