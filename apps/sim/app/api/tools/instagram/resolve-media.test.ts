/**
 * @vitest-environment node
 */
import type { Logger } from '@sim/logger'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHasCloudStorage, mockResolveFileInputToUrl } = vi.hoisted(() => ({
  mockHasCloudStorage: vi.fn(),
  mockResolveFileInputToUrl: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  hasCloudStorage: mockHasCloudStorage,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  resolveFileInputToUrl: mockResolveFileInputToUrl,
}))

import {
  INSTAGRAM_MEDIA_URL_TTL_SECONDS,
  resolveInstagramCarouselMedia,
  resolveInstagramMedia,
} from '@/app/api/tools/instagram/resolve-media'

const logger = {} as Logger
const context = {
  userId: 'user-1',
  requestId: 'request-1',
  logger,
}

function uploadedFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    key: 'execution/workflow-1/execution-1/photo.jpg',
    name: 'photo.jpg',
    size: 1024,
    type: 'image/jpeg',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHasCloudStorage.mockReturnValue(true)
  mockResolveFileInputToUrl.mockImplementation(
    async ({ file, filePath }: { file?: { name?: string }; filePath?: string }) => ({
      fileUrl: filePath || `https://signed.example.com/${file?.name || 'media'}`,
    })
  )
})

describe('resolveInstagramMedia', () => {
  it('accepts a public HTTPS media URL', async () => {
    const result = await resolveInstagramMedia({
      ...context,
      input: 'https://cdn.example.com/photo.jpg',
      role: 'image',
    })

    expect(result).toEqual({
      media: expect.objectContaining({
        url: 'https://cdn.example.com/photo.jpg',
        kind: 'image',
        mimeType: 'image/jpeg',
      }),
    })
  })

  it('rejects a public HTTP media URL before resolving it', async () => {
    const result = await resolveInstagramMedia({
      ...context,
      input: 'http://cdn.example.com/photo.jpg',
      role: 'image',
    })

    expect(result.error).toEqual({
      status: 400,
      message: 'Instagram media URLs must use HTTPS so Meta can download them',
    })
    expect(mockResolveFileInputToUrl).not.toHaveBeenCalled()
  })

  it('resolves an uploaded file with the Instagram publishing URL lifetime', async () => {
    const file = uploadedFile()
    const result = await resolveInstagramMedia({ ...context, input: file, role: 'image' })

    expect(result.media).toEqual({
      url: 'https://signed.example.com/photo.jpg',
      kind: 'image',
      mimeType: 'image/jpeg',
      size: 1024,
      name: 'photo.jpg',
    })
    expect(mockResolveFileInputToUrl).toHaveBeenCalledWith({
      file,
      filePath: undefined,
      ...context,
      presignExpirySeconds: INSTAGRAM_MEDIA_URL_TTL_SECONDS,
    })
  })

  it('requires cloud storage for uploaded files and internal URLs', async () => {
    mockHasCloudStorage.mockReturnValue(false)

    for (const input of [uploadedFile(), '/api/files/serve/execution/photo.jpg']) {
      const result = await resolveInstagramMedia({ ...context, input, role: 'image' })
      expect(result.error).toEqual({
        status: 400,
        message: expect.stringContaining('Cloud storage is required'),
      })
    }
    expect(mockResolveFileInputToUrl).not.toHaveBeenCalled()
  })

  it('validates JPEG MIME type and size without loading file bytes', async () => {
    const invalidType = await resolveInstagramMedia({
      ...context,
      input: uploadedFile({ name: 'photo.png', type: 'image/png' }),
      role: 'image',
      label: 'Image',
    })
    const oversized = await resolveInstagramMedia({
      ...context,
      input: uploadedFile({ size: 8 * 1024 * 1024 + 1 }),
      role: 'image',
      label: 'Image',
    })

    expect(invalidType.error?.message).toBe('Image must be a JPEG image (got image/png)')
    expect(oversized.error?.message).toContain("Instagram's 8MB JPEG limit")
  })

  it.each([
    { role: 'video' as const, maxBytes: 300 * 1024 * 1024, label: 'Video' },
    { role: 'story' as const, maxBytes: 100 * 1024 * 1024, label: 'Story' },
  ])('enforces the $role video size limit', async ({ role, maxBytes, label }) => {
    const result = await resolveInstagramMedia({
      ...context,
      input: uploadedFile({
        key: 'execution/workflow-1/execution-1/video.mp4',
        name: 'video.mp4',
        size: maxBytes + 1,
        type: 'video/mp4',
      }),
      role,
      label,
    })

    expect(result.error?.message).toContain(`video limit for ${role}`)
  })

  it('rejects unsupported video formats', async () => {
    const result = await resolveInstagramMedia({
      ...context,
      input: uploadedFile({ name: 'video.webm', type: 'video/webm' }),
      role: 'video',
      label: 'Video',
    })

    expect(result.error?.message).toBe('Video must be an MP4 or MOV video (got video/webm)')
  })
})

describe('resolveInstagramCarouselMedia', () => {
  it('parses JSON input and infers image and video item types sequentially', async () => {
    let activeResolutions = 0
    let maxActiveResolutions = 0
    mockResolveFileInputToUrl.mockImplementation(async ({ filePath }: { filePath?: string }) => {
      activeResolutions += 1
      maxActiveResolutions = Math.max(maxActiveResolutions, activeResolutions)
      await Promise.resolve()
      activeResolutions -= 1
      return { fileUrl: filePath }
    })

    const result = await resolveInstagramCarouselMedia(
      JSON.stringify([
        'https://cdn.example.com/carousel-1.jpg',
        'https://cdn.example.com/carousel-2.mp4',
      ]),
      context.userId,
      context.requestId,
      logger
    )

    expect(result.items?.map(({ url, kind }) => ({ url, kind }))).toEqual([
      { url: 'https://cdn.example.com/carousel-1.jpg', kind: 'image' },
      { url: 'https://cdn.example.com/carousel-2.mp4', kind: 'video' },
    ])
    expect(maxActiveResolutions).toBe(1)
  })

  it('supports legacy comma-separated URLs with an explicit video prefix', async () => {
    const result = await resolveInstagramCarouselMedia(
      'https://cdn.example.com/carousel-1.jpg, video:https://cdn.example.com/carousel-2.mp4',
      context.userId,
      context.requestId,
      logger
    )

    expect(result.items?.map(({ kind }) => kind)).toEqual(['image', 'video'])
  })

  it('infers media types for uploaded file arrays', async () => {
    const result = await resolveInstagramCarouselMedia(
      [
        uploadedFile(),
        uploadedFile({
          id: 'file-2',
          key: 'execution/workflow-1/execution-1/video.mov',
          name: 'video.mov',
          type: 'video/quicktime',
        }),
      ],
      context.userId,
      context.requestId,
      logger
    )

    expect(result.items?.map(({ kind }) => kind)).toEqual(['image', 'video'])
  })

  it.each([
    { count: 1, label: 'too few' },
    { count: 11, label: 'too many' },
  ])('rejects $label carousel items before resolving them', async ({ count }) => {
    const input = Array.from(
      { length: count },
      (_, index) => `https://cdn.example.com/carousel-${index + 1}.jpg`
    )

    const result = await resolveInstagramCarouselMedia(
      input,
      context.userId,
      context.requestId,
      logger
    )

    expect(result.error).toEqual({
      status: 400,
      message: 'Carousels require between 2 and 10 items',
    })
    expect(mockResolveFileInputToUrl).not.toHaveBeenCalled()
  })

  it('rejects malformed carousel JSON', async () => {
    const result = await resolveInstagramCarouselMedia(
      '[not-json',
      context.userId,
      context.requestId,
      logger
    )

    expect(result.error).toEqual({ status: 400, message: 'Carousel media JSON is invalid' })
  })
})
