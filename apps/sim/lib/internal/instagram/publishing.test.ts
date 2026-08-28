/**
 * @vitest-environment node
 */
import type { Logger } from '@sim/logger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  createMediaContainer,
  INSTAGRAM_MEDIA_URL_TTL_SECONDS,
  publishMediaContainer,
  resolveIgUserId,
  resolveInstagramCarouselMedia,
  resolveInstagramMedia,
} from '@/lib/internal/instagram/publishing'

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
  mockResolveFileInputToUrl.mockImplementation(async ({ file }: { file?: { name?: string } }) => ({
    fileUrl: `https://signed.example.com/${file?.name || 'media'}`,
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveInstagramMedia', () => {
  it('rejects non-file inputs before resolving them', async () => {
    const result = await resolveInstagramMedia({
      ...context,
      input: 'https://cdn.example.com/photo.jpg',
      role: 'image',
    })

    expect(result.error).toEqual({
      status: 400,
      message: 'Media must be a Sim file',
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
      ...context,
      presignExpirySeconds: INSTAGRAM_MEDIA_URL_TTL_SECONDS,
    })
  })

  it('requires cloud storage for publishing files', async () => {
    mockHasCloudStorage.mockReturnValue(false)

    const result = await resolveInstagramMedia({ ...context, input: uploadedFile(), role: 'image' })
    expect(result.error).toEqual({
      status: 400,
      message: expect.stringContaining('Cloud storage is required'),
    })
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
  it('resolves canonical files in order and infers image and video types sequentially', async () => {
    let activeResolutions = 0
    let maxActiveResolutions = 0
    mockResolveFileInputToUrl.mockImplementation(async ({ file }: { file?: { name?: string } }) => {
      activeResolutions += 1
      maxActiveResolutions = Math.max(maxActiveResolutions, activeResolutions)
      await Promise.resolve()
      activeResolutions -= 1
      return { fileUrl: `https://signed.example.com/${file?.name}` }
    })

    const result = await resolveInstagramCarouselMedia(
      [
        uploadedFile({ name: 'carousel-1.jpg' }),
        uploadedFile({ name: 'carousel-2.mp4', type: 'video/mp4' }),
      ],
      context.userId,
      context.requestId,
      logger
    )

    expect(result.items?.map(({ url, kind }) => ({ url, kind }))).toEqual([
      { url: 'https://signed.example.com/carousel-1.jpg', kind: 'image' },
      { url: 'https://signed.example.com/carousel-2.mp4', kind: 'video' },
    ])
    expect(maxActiveResolutions).toBe(1)
  })

  it.each([
    { count: 1, label: 'too few' },
    { count: 11, label: 'too many' },
  ])('rejects $label carousel items before resolving them', async ({ count }) => {
    const input = Array.from({ length: count }, (_, index) =>
      uploadedFile({ id: `file-${index + 1}`, name: `carousel-${index + 1}.jpg` })
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

  it('rejects non-file string inputs', async () => {
    const result = await resolveInstagramCarouselMedia(
      'https://example.com/one.jpg,https://example.com/two.jpg',
      context.userId,
      context.requestId,
      logger
    )

    expect(result.error).toEqual({ status: 400, message: 'Carousel media is required' })
  })
})

describe('Instagram publishing requests', () => {
  it('resolves the connected account when no override is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ user_id: 123 }, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveIgUserId('token')).resolves.toBe('123')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('creates and publishes form-encoded containers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'container-1' }, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ id: 'media-1' }, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createMediaContainer('token', 'user-1', { image_url: 'https://signed.example/image.jpg' })
    ).resolves.toBe('container-1')
    await expect(publishMediaContainer('token', 'user-1', 'container-1')).resolves.toBe('media-1')

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: 'image_url=https%3A%2F%2Fsigned.example%2Fimage.jpg',
    })
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: 'creation_id=container-1',
    })
  })
})
