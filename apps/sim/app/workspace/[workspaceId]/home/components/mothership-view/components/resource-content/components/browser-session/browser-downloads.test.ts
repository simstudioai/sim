import { describe, expect, it } from 'vitest'
import {
  aggregateDownloadPercent,
  formatDownloadBytes,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-downloads'

describe('browser download progress', () => {
  it('aggregates measurable active downloads and ignores finished ones', () => {
    expect(
      aggregateDownloadPercent([
        {
          id: 'active',
          filename: 'large.json',
          state: 'progressing',
          receivedBytes: 25,
          totalBytes: 100,
          startedAt: '',
        },
        {
          id: 'done',
          filename: 'done.json',
          state: 'completed',
          receivedBytes: 100,
          totalBytes: 100,
          startedAt: '',
        },
      ])
    ).toBe(25)
  })

  it('returns null when active downloads have no known total', () => {
    expect(
      aggregateDownloadPercent([
        {
          id: 'active',
          filename: 'unknown.json',
          state: 'progressing',
          receivedBytes: 25,
          totalBytes: 0,
          startedAt: '',
        },
      ])
    ).toBeNull()
  })

  it('formats compact file sizes for the downloads menu', () => {
    expect(formatDownloadBytes(0)).toBe('0 B')
    expect(formatDownloadBytes(7_168)).toBe('7.0 KB')
    expect(formatDownloadBytes(2_621_440)).toBe('2.5 MB')
  })
})
