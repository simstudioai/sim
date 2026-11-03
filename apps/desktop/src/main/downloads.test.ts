import { EventEmitter } from 'node:events'
import { mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { DownloadItem, Session } from 'electron'
import {
  attachDownloadHandling,
  countProgressingAppDownloads,
  sanitizeFilename,
  uniqueDownloadPath,
} from '@/main/downloads'
import type { EventRecorder } from '@/main/observability'

type DownloadState = ReturnType<DownloadItem['getState']>

function startAppDownload(session: EventEmitter) {
  const item = new EventEmitter()
  let state: DownloadState = 'progressing'
  Object.assign(item, {
    getFilename: () => 'export.csv',
    getMimeType: () => 'text/csv',
    getSavePath: () => '/Downloads/export.csv',
    getState: () => state,
    setSaveDialogOptions: vi.fn(),
  })
  session.emit('will-download', {}, item, undefined)
  return {
    finish(finalState: DownloadState) {
      state = finalState
      item.emit('done', {}, finalState)
    },
  }
}

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

describe('countProgressingAppDownloads', () => {
  it('counts an app-window download until it completes or is cancelled', () => {
    const session = new EventEmitter()
    const events = { record: vi.fn() } as unknown as EventRecorder
    attachDownloadHandling(session as unknown as Session, events)
    const before = countProgressingAppDownloads()

    const completed = startAppDownload(session)
    const cancelled = startAppDownload(session)
    expect(countProgressingAppDownloads()).toBe(before + 2)

    completed.finish('completed')
    expect(countProgressingAppDownloads()).toBe(before + 1)
    cancelled.finish('cancelled')
    expect(countProgressingAppDownloads()).toBe(before)
  })
})
