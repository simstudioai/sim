import { describe, expect, it } from 'vitest'
import type { DesktopLocalFileEntry, DesktopLocalFileResponse } from './local-files'
import {
  assertImportableManifest,
  readImportEntry,
  sanitizeBrowserToolResultForModel,
} from './tool-results'

describe('browser screenshot model projection', () => {
  it('keeps an image usable when an older desktop omits coordinate metadata', () => {
    const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
    })
    expect(result?.attachment).toBeDefined()
    expect(result?.content).toContain('coordinate mapping is unavailable')
    expect(result?.content).not.toContain('cssX =')
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '0.5'])(
    'does not publish an invalid scale %s',
    (scale) => {
      const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
        scale,
        viewport: { width: 1600, height: 900 },
      })
      expect(result?.content).toContain('Viewport: 1600 × 900 CSS pixels')
      expect(result?.content).toContain('coordinate mapping is unavailable')
      expect(result?.content).not.toContain('cssX =')
    }
  )

  it('does not invent a crop origin or encode malformed dimensions into the caption', () => {
    const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      scale: 2,
      clip: { x: '10', y: 20 },
      viewport: { width: 0, height: 900 },
      imageSize: { width: Number.POSITIVE_INFINITY, height: 640 },
    })
    expect(result?.attachment).toBeDefined()
    expect(result?.content).toContain('coordinate mapping is unavailable')
    expect(result?.content).not.toMatch(/Viewport:|Encoded image:|Crop origin:|cssX =/)
  })

  it('maps each crop axis independently when pixel rounding changes its aspect ratio', () => {
    const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      scale: 2.5,
      clip: { x: 0, y: 20, width: 1.5, height: 100 },
      imageSize: { width: 3, height: 200 },
    })
    expect(result?.content).toContain('Crop origin: (0, 20) in viewport CSS pixels')
    expect(result?.content).toContain('cssX = 0 + imageX / 2; cssY = 20 + imageY / 2')
  })

  it('keeps a legacy crop image without publishing its unverified scalar mapping', () => {
    const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      scale: 3 / 1.1,
      clip: { x: 0.1, y: 20, width: 1.1, height: 100 },
    })
    expect(result?.attachment).toBeDefined()
    expect(result?.content).toContain('coordinate mapping is unavailable')
    expect(result?.content).not.toContain('cssX =')
  })

  it('uses both encoded dimensions for a resized viewport', () => {
    const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      scale: 0.5,
      viewport: { width: 1600, height: 901 },
      imageSize: { width: 800, height: 451 },
    })
    expect(result?.content).toContain(`cssX = 0 + imageX / 0.5; cssY = 0 + imageY / ${451 / 901}`)
  })

  it('withholds a legacy viewport scalar when encoded dimensions are unavailable', () => {
    const result = sanitizeBrowserToolResultForModel('browser_screenshot', {
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      scale: 0.5,
      viewport: { width: 2048, height: 1025 },
    })
    expect(result?.attachment).toBeDefined()
    expect(result?.scale).toBe(0.5)
    expect(result?.content).toContain('Viewport: 2048 × 1025 CSS pixels')
    expect(result?.content).toContain('coordinate mapping is unavailable')
    expect(result?.content).not.toContain('cssY =')
  })

  it('leaves non-image tool results unchanged', () => {
    const result = { outline: 'button "Continue" [ref=3]' }
    expect(sanitizeBrowserToolResultForModel('browser_snapshot', result)).toBe(result)
    expect(sanitizeBrowserToolResultForModel('browser_snapshot', undefined)).toBeUndefined()
  })
})

describe('import file reads', () => {
  const entry: DesktopLocalFileEntry = {
    relativePath: 'notes.txt',
    kind: 'file',
    size: 6,
    revision: 'rev-1',
  }

  function chunks(...parts: Array<{ bytes: string; eof: boolean }>) {
    const queue = [...parts]
    return async (): Promise<DesktopLocalFileResponse> => {
      const next = queue.shift()
      if (!next) throw new Error('read past the end')
      return {
        ok: true,
        data: { kind: 'chunk', bytes: new TextEncoder().encode(next.bytes), eof: next.eof },
      }
    }
  }

  it('reads a file across chunks', async () => {
    const parts = await readImportEntry(
      'call-1',
      entry,
      chunks({ bytes: 'abc', eof: false }, { bytes: 'def', eof: true })
    )
    expect(new TextDecoder().decode(Buffer.concat(parts))).toBe('abcdef')
  })

  it.each([
    ['ends early', [{ bytes: 'abc', eof: true }]],
    ['grows past its listed size', [{ bytes: 'abcdefg', eof: true }]],
    ['stalls', [{ bytes: '', eof: false }]],
    ['keeps going past its listed size', [{ bytes: 'abcdef', eof: false }]],
  ])('refuses a file that %s since the manifest listed it', async (_case, parts) => {
    await expect(readImportEntry('call-1', entry, chunks(...parts))).rejects.toThrow(
      'The local file changed or its transfer was incomplete.'
    )
  })
})

describe('importable manifests', () => {
  it.each([
    ['a backslash', 'q3\\draft.txt'],
    ['a blank name', 'q3/ '],
    ['a dot segment after trimming', '.. /notes.txt'],
  ])('refuses %s before anything is imported', (_case, relativePath) => {
    expect(() =>
      assertImportableManifest({
        kind: 'manifest',
        name: 'Reports',
        targetWorkspaceId: 'ws-1',
        entries: [
          { relativePath: '', kind: 'directory', size: 0, revision: 'r0' },
          { relativePath, kind: 'file', size: 1, revision: 'r1' },
        ],
      })
    ).toThrow('Sim cannot store a file or folder named')
  })
})
