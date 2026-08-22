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
  it('keeps the original name when it is available', () => {
    expect(uniqueDownloadPath('/Downloads', 'report.csv', () => false)).toBe(
      '/Downloads/report.csv'
    )
  })

  it('adds a copy number before the extension instead of overwriting', () => {
    const occupied = new Set(['/Downloads/report.csv', '/Downloads/report (1).csv'])
    expect(uniqueDownloadPath('/Downloads', 'report.csv', (path) => occupied.has(path))).toBe(
      '/Downloads/report (2).csv'
    )
  })
})
