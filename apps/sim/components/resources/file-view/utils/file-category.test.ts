/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/utils/validation', () => ({
  SUPPORTED_CODE_EXTENSIONS: ['js', 'ts', 'py', 'go', 'rs', 'sh', 'sql'],
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  getFileExtension: (filename: string): string => {
    const lastDot = filename.lastIndexOf('.')
    return lastDot !== -1 ? filename.slice(lastDot + 1).toLowerCase() : ''
  },
}))

import { resolveFileCategory } from './file-category'

describe('resolveFileCategory — MIME type routing', () => {
  describe('text-editable', () => {
    it.each([
      'text/plain',
      'text/markdown',
      'application/json',
      'application/x-yaml',
      'text/csv',
      'text/html',
      'text/xml',
      'application/xml',
      'text/css',
      'text/javascript',
      'application/javascript',
      'application/typescript',
      'application/toml',
      'text/x-python',
      'text/x-sh',
      'text/x-sql',
      'image/svg+xml',
      'text/x-mermaid',
    ])('%s → text-editable', (mime) => {
      expect(resolveFileCategory(mime, 'file.txt')).toBe('text-editable')
    })
  })

  describe('iframe-previewable (PDF)', () => {
    it('application/pdf → iframe-previewable', () => {
      expect(resolveFileCategory('application/pdf', 'doc.pdf')).toBe('iframe-previewable')
    })

    it('text/x-pdflibjs → iframe-previewable', () => {
      expect(resolveFileCategory('text/x-pdflibjs', 'generated.pdf')).toBe('iframe-previewable')
    })
  })

  describe('image-previewable', () => {
    it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])(
      '%s → image-previewable',
      (mime) => {
        expect(resolveFileCategory(mime, 'img.png')).toBe('image-previewable')
      }
    )
  })

  describe('audio-previewable', () => {
    it.each([
      'audio/mpeg',
      'audio/mp4',
      'audio/wav',
      'audio/webm',
      'audio/ogg',
      'audio/flac',
      'audio/aac',
      'audio/opus',
      'audio/x-m4a',
    ])('%s → audio-previewable', (mime) => {
      expect(resolveFileCategory(mime, 'audio.mp3')).toBe('audio-previewable')
    })
  })

  describe('video-previewable', () => {
    it.each(['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm'])(
      '%s → video-previewable',
      (mime) => {
        expect(resolveFileCategory(mime, 'video.mp4')).toBe('video-previewable')
      }
    )
  })

  describe('docx-previewable', () => {
    it('application/vnd.openxmlformats-officedocument.wordprocessingml.document → docx-previewable', () => {
      expect(
        resolveFileCategory(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'doc.docx'
        )
      ).toBe('docx-previewable')
    })

    it('text/x-docxjs → docx-previewable', () => {
      expect(resolveFileCategory('text/x-docxjs', 'doc.docx')).toBe('docx-previewable')
    })
  })

  describe('pptx-previewable', () => {
    it('application/vnd.openxmlformats-officedocument.presentationml.presentation → pptx-previewable', () => {
      expect(
        resolveFileCategory(
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'deck.pptx'
        )
      ).toBe('pptx-previewable')
    })

    it('text/x-pptxgenjs → pptx-previewable', () => {
      expect(resolveFileCategory('text/x-pptxgenjs', 'deck.pptx')).toBe('pptx-previewable')
    })
  })

  describe('xlsx-previewable', () => {
    it('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet → xlsx-previewable', () => {
      expect(
        resolveFileCategory(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'data.xlsx'
        )
      ).toBe('xlsx-previewable')
    })
  })
})

describe('resolveFileCategory — extension fallback', () => {
  describe('text-editable extensions', () => {
    it.each(['md', 'txt', 'json', 'yaml', 'yml', 'csv', 'html', 'htm', 'svg', 'mmd'])(
      '.%s → text-editable',
      (ext) => {
        expect(resolveFileCategory(null, `file.${ext}`)).toBe('text-editable')
      }
    )
  })

  describe('code extensions from SUPPORTED_CODE_EXTENSIONS', () => {
    it.each(['js', 'ts', 'py', 'go', 'rs', 'sh', 'sql'])('.%s → text-editable', (ext) => {
      expect(resolveFileCategory(null, `file.${ext}`)).toBe('text-editable')
    })
  })

  describe('pdf extension', () => {
    it('.pdf → iframe-previewable', () => {
      expect(resolveFileCategory(null, 'document.pdf')).toBe('iframe-previewable')
    })
  })

  describe('image extensions', () => {
    it.each(['png', 'jpg', 'jpeg', 'gif', 'webp'])('.%s → image-previewable', (ext) => {
      expect(resolveFileCategory(null, `image.${ext}`)).toBe('image-previewable')
    })
  })

  describe('audio extensions', () => {
    it.each(['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac', 'opus'])(
      '.%s → audio-previewable',
      (ext) => {
        expect(resolveFileCategory(null, `audio.${ext}`)).toBe('audio-previewable')
      }
    )
  })

  describe('video extensions', () => {
    it.each(['mp4', 'mov', 'avi', 'mkv', 'webm'])('.%s → video-previewable', (ext) => {
      expect(resolveFileCategory(null, `video.${ext}`)).toBe('video-previewable')
    })
  })

  describe('docx extension', () => {
    it('.docx → docx-previewable', () => {
      expect(resolveFileCategory(null, 'doc.docx')).toBe('docx-previewable')
    })
  })

  describe('pptx extension', () => {
    it('.pptx → pptx-previewable', () => {
      expect(resolveFileCategory(null, 'deck.pptx')).toBe('pptx-previewable')
    })
  })

  describe('xlsx extension', () => {
    it('.xlsx → xlsx-previewable', () => {
      expect(resolveFileCategory(null, 'data.xlsx')).toBe('xlsx-previewable')
    })
  })

  describe('unsupported', () => {
    it('unknown extension → unsupported', () => {
      expect(resolveFileCategory(null, 'file.xyz')).toBe('unsupported')
    })

    it('unknown mime with unknown extension → unsupported', () => {
      expect(resolveFileCategory('application/octet-stream', 'file.bin')).toBe('unsupported')
    })

    it('no extension, no mime → unsupported', () => {
      expect(resolveFileCategory(null, 'LICENSE')).toBe('unsupported')
    })
  })
})

describe('resolveFileCategory — MIME priority', () => {
  it('text/plain MIME + .pdf extension → text-editable (MIME wins)', () => {
    expect(resolveFileCategory('text/plain', 'notes.pdf')).toBe('text-editable')
  })

  it('application/pdf MIME + .txt extension → iframe-previewable (MIME wins)', () => {
    expect(resolveFileCategory('application/pdf', 'disguised.txt')).toBe('iframe-previewable')
  })

  it('null MIME falls through to extension routing', () => {
    expect(resolveFileCategory(null, 'data.xlsx')).toBe('xlsx-previewable')
  })

  it('unknown MIME falls through to extension routing', () => {
    expect(resolveFileCategory('application/octet-stream', 'data.xlsx')).toBe('xlsx-previewable')
  })
})

describe('resolveFileCategory — extension case', () => {
  it('recognises uppercase extension via extension lookup (getFileExtension lowercases)', () => {
    expect(resolveFileCategory(null, 'README.MD')).toBe('text-editable')
  })

  it('handles mixed-case correctly for json', () => {
    expect(resolveFileCategory(null, 'config.JSON')).toBe('text-editable')
  })
})
