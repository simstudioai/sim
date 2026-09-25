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
})

describe('resolveInstagramCarouselMedia', () => {
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
})
