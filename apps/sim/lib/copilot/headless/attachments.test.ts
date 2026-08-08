import { describe, expect, it } from 'vitest'
import {
  MAX_V2_CHAT_ATTACHMENT_BYTES,
  MAX_V2_CHAT_ATTACHMENTS_TOTAL_BYTES,
  MAX_V2_CHAT_IMAGE_DIMENSION,
  MAX_V2_CHAT_IMAGE_PIXELS,
  MAX_V2_CHAT_IMAGES_TOTAL_PIXELS,
  MAX_V2_CHAT_TEXT_ATTACHMENT_BYTES,
} from '@/lib/api/contracts/v2/chat'
import { prepareV2ChatAttachments } from '@/lib/copilot/headless/attachments'

function attachment(name: string, mediaType: string, bytes: Buffer) {
  return { name, mediaType, data: bytes.toString('base64') }
}

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function gifHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(10)
  buffer.write('GIF89a', 0, 'ascii')
  buffer.writeUInt16LE(width, 6)
  buffer.writeUInt16LE(height, 8)
  return buffer
}

describe('prepareV2ChatAttachments', () => {
  it('maps byte-sniffed images, PDFs, and UTF-8 text to Mothership attachments', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2b6WQAAAABJRU5ErkJggg==',
      'base64'
    )
    const result = prepareV2ChatAttachments([
      attachment('screenshot.png', 'image/png', png),
      attachment('report.pdf', 'application/pdf', Buffer.from('%PDF-1.7\nexample')),
      attachment('notes.md', 'text/markdown', Buffer.from('# Notes\n', 'utf8')),
    ])

    expect(result).toEqual({
      success: true,
      attachments: [
        {
          type: 'image',
          filename: 'screenshot.png',
          source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
        },
        {
          type: 'document',
          filename: 'report.pdf',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: Buffer.from('%PDF-1.7\nexample').toString('base64'),
          },
        },
        {
          type: 'document',
          filename: 'notes.md',
          source: {
            type: 'base64',
            media_type: 'text/markdown',
            data: Buffer.from('# Notes\n', 'utf8').toString('base64'),
          },
        },
      ],
    })
  })

  it('preserves each supported raster image format', () => {
    const images = [
      {
        name: 'photo.jpg',
        mediaType: 'image/jpeg',
        data: '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJUAB//Z',
      },
      {
        name: 'animation.gif',
        mediaType: 'image/gif',
        data: 'R0lGODlhAQABAIAAAExpcQAAACH5BAUAAAAALAAAAAABAAEAAAICRAEAOw==',
      },
      {
        name: 'image.webp',
        mediaType: 'image/webp',
        data: 'UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAAFAJiWkAANwAP79NmgA',
      },
    ]

    for (const image of images) {
      expect(
        prepareV2ChatAttachments([
          attachment(image.name, image.mediaType, Buffer.from(image.data, 'base64')),
        ])
      ).toMatchObject({
        success: true,
        attachments: [{ type: 'image', source: { media_type: image.mediaType } }],
      })
    }
  })

  it('rejects non-canonical base64 before forwarding it', () => {
    expect(
      prepareV2ChatAttachments([{ name: 'notes.txt', mediaType: 'text/plain', data: 'YQ= ' }])
    ).toEqual({
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Attachment "notes.txt" data must be canonical base64',
      },
    })
  })

  it('rejects unsupported types and declared image types that do not match the bytes', () => {
    expect(
      prepareV2ChatAttachments([
        attachment('archive.zip', 'application/zip', Buffer.from('PK\x03\x04')),
      ])
    ).toMatchObject({ success: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE' } })

    expect(
      prepareV2ChatAttachments([
        attachment('fake.png', 'image/png', Buffer.from('<script>alert(1)</script>')),
      ])
    ).toMatchObject({ success: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE' } })
  })

  it('rejects malformed images even when their magic bytes match the declared type', () => {
    expect(
      prepareV2ChatAttachments([
        attachment(
          'truncated.png',
          'image/png',
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        ),
      ])
    ).toEqual({
      success: false,
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Attachment "truncated.png" is not a readable image',
      },
    })
  })

  it('rejects compressed images with an oversized axis before forwarding them', () => {
    expect(
      prepareV2ChatAttachments([
        attachment('wide.png', 'image/png', pngHeader(MAX_V2_CHAT_IMAGE_DIMENSION + 1, 1)),
      ])
    ).toMatchObject({ success: false, error: { code: 'PAYLOAD_TOO_LARGE' } })

    expect(
      prepareV2ChatAttachments([
        attachment('tall.gif', 'image/gif', gifHeader(1, MAX_V2_CHAT_IMAGE_DIMENSION + 1)),
      ])
    ).toMatchObject({ success: false, error: { code: 'PAYLOAD_TOO_LARGE' } })
  })

  it('rejects compressed images over the total decoded-pixel limit', () => {
    const width = 5000
    const height = Math.floor(MAX_V2_CHAT_IMAGE_PIXELS / width) + 1
    expect(width).toBeLessThanOrEqual(MAX_V2_CHAT_IMAGE_DIMENSION)
    expect(height).toBeLessThanOrEqual(MAX_V2_CHAT_IMAGE_DIMENSION)

    expect(
      prepareV2ChatAttachments([
        attachment('too-many-pixels.png', 'image/png', pngHeader(width, height)),
      ])
    ).toMatchObject({ success: false, error: { code: 'PAYLOAD_TOO_LARGE' } })
  })

  it('enforces an aggregate decoded-pixel limit across images', () => {
    const width = 4000
    const height = 4000
    const pixelsPerImage = width * height
    expect(pixelsPerImage).toBe(MAX_V2_CHAT_IMAGE_PIXELS)
    expect(pixelsPerImage * 2).toBe(MAX_V2_CHAT_IMAGES_TOTAL_PIXELS)

    expect(
      prepareV2ChatAttachments([
        attachment('one.png', 'image/png', pngHeader(width, height)),
        attachment('two.gif', 'image/gif', gifHeader(width, height)),
        attachment('three.png', 'image/png', pngHeader(1, 1)),
      ])
    ).toEqual({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: `Images exceed the ${MAX_V2_CHAT_IMAGES_TOTAL_PIXELS}-pixel aggregate limit`,
      },
    })
  })

  it('enforces text and binary per-file byte limits', () => {
    expect(
      prepareV2ChatAttachments([
        attachment(
          'large.txt',
          'text/plain',
          Buffer.alloc(MAX_V2_CHAT_TEXT_ATTACHMENT_BYTES + 1, 0x61)
        ),
      ])
    ).toMatchObject({ success: false, error: { code: 'PAYLOAD_TOO_LARGE' } })

    const oversizedPng = Buffer.alloc(MAX_V2_CHAT_ATTACHMENT_BYTES + 1)
    pngHeader(1, 1).copy(oversizedPng)
    expect(
      prepareV2ChatAttachments([attachment('large.png', 'image/png', oversizedPng)])
    ).toMatchObject({ success: false, error: { code: 'PAYLOAD_TOO_LARGE' } })
  })

  it('enforces the decoded aggregate byte limit across attachments', () => {
    const imageBytes = Buffer.alloc(4 * 1024 * 1024)
    pngHeader(1, 1).copy(imageBytes)

    expect(imageBytes.byteLength * 3).toBeGreaterThan(MAX_V2_CHAT_ATTACHMENTS_TOTAL_BYTES)
    expect(
      prepareV2ChatAttachments([
        attachment('one.png', 'image/png', imageBytes),
        attachment('two.png', 'image/png', imageBytes),
        attachment('three.png', 'image/png', imageBytes),
      ])
    ).toMatchObject({ success: false, error: { code: 'PAYLOAD_TOO_LARGE' } })
  })

  it('rejects binary data mislabeled as text', () => {
    expect(
      prepareV2ChatAttachments([
        attachment('binary.txt', 'text/plain', Buffer.from([0xff, 0xfe, 0xfd])),
      ])
    ).toMatchObject({ success: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE' } })
  })
})
