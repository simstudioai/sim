import { mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { sanitizeFilename, uniqueDownloadPath } from '@/main/downloads'

describe('sanitizeFilename', () => {
  it('neutralizes path separators and leading dots', () => {
    const sanitized = sanitizeFilename('../../etc/passwd')
    expect(sanitized).not.toContain('/')
    expect(sanitized.startsWith('.')).toBe(false)
  })
})

describe('uniqueDownloadPath', () => {
  it('treats a dangling symlink as occupied', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-download-path-'))
    symlinkSync(join(directory, 'missing-target'), join(directory, 'report.csv'))

    await expect(
      uniqueDownloadPath(directory, 'report.csv', {
        suffixForAttempt: () => 'safe-id',
      })
    ).resolves.toBe(join(directory, 'report (safe-id).csv'))
  })

  it('atomically separates simultaneous allocations of the same name', async () => {
    const reservations = new Set<string>()
    const options = {
      pathExists: async () => false,
      reservePath: (path: string) => {
        if (reservations.has(path)) return false
        reservations.add(path)
        return true
      },
      suffixForAttempt: (attempt: number) => `copy-${attempt}`,
    }

    const [first, second] = await Promise.all([
      uniqueDownloadPath('/Downloads', 'report.csv', options),
      uniqueDownloadPath('/Downloads', 'report.csv', options),
    ])

    expect(new Set([first, second])).toEqual(
      new Set(['/Downloads/report.csv', '/Downloads/report (copy-1).csv'])
    )
  })
})
