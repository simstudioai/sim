import { describe, expect, it } from 'vitest'
import {
  SUPPORTED_ATTACHMENT_EXTENSIONS,
  sniffImageContentType,
  validateAttachmentFileType,
} from '@/lib/uploads/utils/validation'

describe('sniffImageContentType', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])
  const gif87 = Buffer.from('GIF87a....', 'latin1')
  const gif89 = Buffer.from('GIF89a....', 'latin1')
  const webp = Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'latin1'),
  ])

  it('detects real raster image formats from magic bytes', () => {
    expect(sniffImageContentType(png)).toBe('image/png')
    expect(sniffImageContentType(jpeg)).toBe('image/jpeg')
    expect(sniffImageContentType(gif87)).toBe('image/gif')
    expect(sniffImageContentType(gif89)).toBe('image/gif')
    expect(sniffImageContentType(webp)).toBe('image/webp')
  })

  it('rejects non-image content, including image-shaped strings and SVG', () => {
    expect(
      sniffImageContentType(Buffer.from('<html><script>x</script></html>', 'utf-8'))
    ).toBeNull()
    expect(sniffImageContentType(Buffer.from('<svg xmlns="...">', 'utf-8'))).toBeNull()
    expect(sniffImageContentType(Buffer.from('RIFFxxxxAVI ', 'latin1'))).toBeNull()
    expect(sniffImageContentType(Buffer.alloc(0))).toBeNull()
    expect(sniffImageContentType(Buffer.from([0x89, 0x50]))).toBeNull()
  })
})

describe('validateAttachmentFileType', () => {
  it('accepts image files (png, jpg, gif, webp, svg)', () => {
    expect(validateAttachmentFileType('screenshot.png')).toBeNull()
    expect(validateAttachmentFileType('photo.jpg')).toBeNull()
    expect(validateAttachmentFileType('photo.JPEG')).toBeNull()
    expect(validateAttachmentFileType('animation.gif')).toBeNull()
    expect(validateAttachmentFileType('image.webp')).toBeNull()
    expect(validateAttachmentFileType('icon.svg')).toBeNull()
  })

  it('accepts video files (mp4, mov, webm)', () => {
    expect(validateAttachmentFileType('clip.mp4')).toBeNull()
    expect(validateAttachmentFileType('clip.mov')).toBeNull()
    expect(validateAttachmentFileType('clip.webm')).toBeNull()
  })

  it('accepts audio files (mp3, wav, m4a)', () => {
    expect(validateAttachmentFileType('voice.mp3')).toBeNull()
    expect(validateAttachmentFileType('voice.wav')).toBeNull()
    expect(validateAttachmentFileType('voice.m4a')).toBeNull()
  })

  it('accepts document files (pdf, docx, csv, md)', () => {
    expect(validateAttachmentFileType('report.pdf')).toBeNull()
    expect(validateAttachmentFileType('letter.docx')).toBeNull()
    expect(validateAttachmentFileType('data.csv')).toBeNull()
    expect(validateAttachmentFileType('notes.md')).toBeNull()
  })

  it('accepts code files (ts, py, sh, json)', () => {
    expect(validateAttachmentFileType('app.ts')).toBeNull()
    expect(validateAttachmentFileType('main.py')).toBeNull()
    expect(validateAttachmentFileType('script.sh')).toBeNull()
    expect(validateAttachmentFileType('config.json')).toBeNull()
  })

  it('rejects executables and unknown extensions', () => {
    expect(validateAttachmentFileType('virus.exe')?.code).toBe('UNSUPPORTED_FILE_TYPE')
    expect(validateAttachmentFileType('installer.msi')?.code).toBe('UNSUPPORTED_FILE_TYPE')
    expect(validateAttachmentFileType('archive.dmg')?.code).toBe('UNSUPPORTED_FILE_TYPE')
    expect(validateAttachmentFileType('binary.bin')?.code).toBe('UNSUPPORTED_FILE_TYPE')
  })

  it('rejects files with no extension', () => {
    const result = validateAttachmentFileType('README')
    expect(result?.code).toBe('UNSUPPORTED_FILE_TYPE')
    expect(result?.message).toContain('README')
  })

  it('rejects files with non-alphanumeric extensions', () => {
    expect(validateAttachmentFileType('odd.<>')?.code).toBe('UNSUPPORTED_FILE_TYPE')
    expect(validateAttachmentFileType('foo. ')?.code).toBe('UNSUPPORTED_FILE_TYPE')
  })

  it('does not contain duplicate extensions (e.g. webm)', () => {
    const seen = new Set<string>()
    for (const ext of SUPPORTED_ATTACHMENT_EXTENSIONS) {
      expect(seen.has(ext)).toBe(false)
      seen.add(ext)
    }
  })

  it('returns supportedTypes list in error', () => {
    const result = validateAttachmentFileType('foo.exe')
    expect(result?.supportedTypes).toEqual(expect.arrayContaining(['png', 'pdf', 'mp4', 'mp3']))
  })
})
