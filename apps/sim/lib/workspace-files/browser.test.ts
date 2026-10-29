import { describe, expect, it } from 'vitest'
import {
  fileBrowserKinds,
  fileBrowserMimeType,
  fileBrowserTypeLabel,
} from '@/lib/workspace-files/browser'

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

describe('fileBrowserKinds', () => {
  it('counts any audio/* or video/* type as Audio or Video, as its Type label does', () => {
    expect([...fileBrowserKinds('video/x-unlisted', 'clip.bin')]).toEqual(['video'])
    expect(fileBrowserTypeLabel('video/x-unlisted', 'clip.bin')).toBe('Video')
    expect([...fileBrowserKinds('Audio/X-Unlisted; rate=44100', 'song.bin')]).toEqual(['audio'])
  })

  it('reads a document by its extension, whatever its stored type', () => {
    expect(fileBrowserKinds('application/octet-stream', 'notes.md').has('document')).toBe(true)
  })
})

describe('table lookups by name', () => {
  it('never reads an Object.prototype member as a label or a MIME type', () => {
    expect(fileBrowserTypeLabel('constructor', 'noext')).toBe('constructor')
    expect(fileBrowserTypeLabel('toString', 'noext')).toBe('toString')
    expect(fileBrowserMimeType('', 'file.constructor')).toBe(fileBrowserMimeType('', 'file.zzz'))
    expect(fileBrowserTypeLabel('', 'file.__proto__')).toBe('__PROTO__')
  })
})
