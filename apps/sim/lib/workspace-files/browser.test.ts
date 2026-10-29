import { describe, expect, it } from 'vitest'
import { fileBrowserMimeType, fileBrowserTypeLabel } from '@/lib/workspace-files/browser'

describe('fileBrowserTypeLabel', () => {
  it('reads a stored type with parameters or mixed case as its bare media type', () => {
    expect(fileBrowserMimeType('Image/PNG; charset=binary', 'file.bin')).toBe('image/png')
    expect(fileBrowserTypeLabel(' Text/Markdown ; charset=utf-8', 'notes.txt')).toBe(
      fileBrowserTypeLabel('text/markdown', 'notes.txt')
    )
  })

  it('falls back to the extension when the stored type is generic, however it is spelled', () => {
    expect(fileBrowserMimeType('Application/Octet-Stream; x=1', 'song.mp3')).toBe(
      fileBrowserMimeType('', 'song.mp3')
    )
  })
})
