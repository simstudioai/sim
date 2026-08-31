import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { sanitizeFilename, suggestedFilename, uniqueDownloadPath } from '@/main/downloads'

describe('sanitizeFilename', () => {
  it('neutralizes path separators and leading dots', () => {
    const sanitized = sanitizeFilename('../../etc/passwd')
    expect(sanitized).not.toContain('/')
    expect(sanitized.startsWith('.')).toBe(false)
  })

  it('strips control characters and trims', () => {
    expect(sanitizeFilename(' report\u0000\u001f.csv ')).toBe('report.csv')
  })

  it('caps the length', () => {
    expect(sanitizeFilename('a'.repeat(500)).length).toBeLessThanOrEqual(200)
  })
})

describe('suggestedFilename', () => {
  const now = new Date('2026-07-15T12:30:45.000Z')

  it('keeps a usable server-suggested name', () => {
    expect(suggestedFilename('workflow-logs.csv', 'text/csv', now)).toBe('workflow-logs.csv')
  })

  it('falls back to a timestamped name with a mime extension for blobs', () => {
    expect(suggestedFilename('', 'text/csv', now)).toBe('download-2026-07-15T12-30-45.csv')
    expect(suggestedFilename('download', 'application/json', now)).toBe(
      'download-2026-07-15T12-30-45.json'
    )
  })

  it('omits the extension for unknown mime types', () => {
    expect(suggestedFilename('', 'application/x-mystery', now)).toBe('download-2026-07-15T12-30-45')
  })
})

describe('uniqueDownloadPath', () => {
  it('keeps the original name when it is available', async () => {
    await expect(
      uniqueDownloadPath('/Downloads', 'report.csv', { pathExists: () => false })
    ).resolves.toBe('/Downloads/report.csv')
  })

  it('uses a collision-resistant suffix instead of scanning sequential copy names', async () => {
    const occupied = new Set(['/Downloads/report.csv'])
    await expect(
      uniqueDownloadPath('/Downloads', 'report.csv', {
        pathExists: (path) => occupied.has(path),
        suffixForAttempt: () => 'safe-id',
      })
    ).resolves.toBe('/Downloads/report (safe-id).csv')
  })

  it('checks a pre-existing filesystem entry without blocking the caller', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sim-download-path-'))
    writeFileSync(join(directory, 'report.csv'), 'existing')

    const allocation = uniqueDownloadPath(directory, 'report.csv', {
      suffixForAttempt: () => 'safe-id',
    })

    await expect(allocation).resolves.toBe(join(directory, 'report (safe-id).csv'))
  })

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

  it('stops after the configured collision cap', async () => {
    const pathExists = vi.fn(async () => true)

    await expect(
      uniqueDownloadPath('/Downloads', 'report.csv', {
        maxAttempts: 3,
        pathExists,
        suffixForAttempt: (attempt) => `copy-${attempt}`,
      })
    ).resolves.toBeNull()
    expect(pathExists).toHaveBeenCalledTimes(3)
  })

  it('abandons an allocation torn down while the filesystem check is pending', async () => {
    let resolveExists = (_exists: boolean) => {}
    const exists = new Promise<boolean>((resolve) => {
      resolveExists = resolve
    })
    let active = true
    const reservePath = vi.fn(() => true)
    const allocation = uniqueDownloadPath('/Downloads', 'report.csv', {
      isActive: () => active,
      pathExists: () => exists,
      reservePath,
    })

    active = false
    resolveExists(false)

    await expect(allocation).resolves.toBeNull()
    expect(reservePath).not.toHaveBeenCalled()
  })
})
