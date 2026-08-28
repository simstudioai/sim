/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMediaContainer: vi.fn(),
  publishMediaContainer: vi.fn(),
  resolveIgUserId: vi.fn(),
  resolveInstagramCarouselMedia: vi.fn(),
  resolveInstagramMedia: vi.fn(),
  waitForContainerReady: vi.fn(),
}))

vi.mock('@/lib/internal/instagram/publishing', () => mocks)

import { executeInstagramTool } from '@/lib/internal/instagram/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { instagramDownloadMediaTool } from '@/tools/instagram/download_media'
import { instagramPublishCarouselTool } from '@/tools/instagram/publish_carousel'
import { instagramPublishImageTool } from '@/tools/instagram/publish_image'
import { instagramPublishReelTool } from '@/tools/instagram/publish_reel'
import { instagramPublishStoryTool } from '@/tools/instagram/publish_story'
import { instagramPublishVideoTool } from '@/tools/instagram/publish_video'

const image = {
  id: 'image-1',
  name: 'image.jpg',
  size: 1024,
  type: 'image/jpeg',
  key: 'execution/workflow-1/execution-1/image.jpg',
}
const video = {
  id: 'video-1',
  name: 'video.mp4',
  size: 2048,
  type: 'video/mp4',
  key: 'execution/workflow-1/execution-1/video.mp4',
}

function request(
  toolId: string,
  input: Record<string, unknown>,
  signal = new AbortController().signal
): InternalToolOperationCall {
  return {
    toolId,
    input,
    headers: new Headers(),
    context: {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      metadata: {},
    },
    requestId: 'request-1',
    signal,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveIgUserId.mockImplementation(async (_token: string, override?: string) => {
    return override || 'ig-user-1'
  })
  mocks.createMediaContainer.mockResolvedValue('container-1')
  mocks.waitForContainerReady.mockResolvedValue({ statusCode: 'FINISHED', status: null })
  mocks.publishMediaContainer.mockResolvedValue('media-1')
})

describe('Instagram operation declarations', () => {
  it('contains no HTTP-shaped request metadata for all six internal tools', () => {
    const tools = [
      instagramDownloadMediaTool,
      instagramPublishCarouselTool,
      instagramPublishImageTool,
      instagramPublishReelTool,
      instagramPublishStoryTool,
      instagramPublishVideoTool,
    ]

    for (const tool of tools) {
      expect(tool.operation.input).toBeTypeOf('function')
      expect(tool).not.toHaveProperty('request')
      expect(tool.operation).not.toHaveProperty('transport')
      expect(tool.operation).not.toHaveProperty('url')
      expect(tool.operation).not.toHaveProperty('method')
      expect(tool.operation).not.toHaveProperty('headers')
      expect(tool.operation).not.toHaveProperty('body')
    }
  })

  it('does not serialize trusted execution scope into download input', () => {
    const input = instagramDownloadMediaTool.operation.input({
      accessToken: 'token',
      mediaId: 'media-1',
      _context: {
        workspaceId: 'untrusted-workspace',
        workflowId: 'untrusted-workflow',
        executionId: 'untrusted-execution',
      },
    })

    expect(input).toEqual({ accessToken: 'token', mediaId: 'media-1' })
  })
})

describe('Instagram publish operations', () => {
  it('publishes an image with the exact optional Meta fields', async () => {
    mocks.resolveInstagramMedia.mockResolvedValue({
      media: { url: 'https://signed.example/image.jpg', kind: 'image' },
    })

    const response = await executeInstagramTool(
      request('instagram_publish_image', {
        accessToken: 'token',
        image,
        caption: 'Caption',
        altText: 'Alt text',
        isAiGenerated: true,
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      output: { containerId: 'container-1', mediaId: 'media-1', statusCode: 'FINISHED' },
    })
    expect(mocks.resolveInstagramMedia).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', role: 'image', input: image })
    )
    expect(mocks.createMediaContainer).toHaveBeenCalledWith(
      'token',
      'ig-user-1',
      {
        image_url: 'https://signed.example/image.jpg',
        caption: 'Caption',
        alt_text: 'Alt text',
        is_ai_generated: true,
      },
      expect.any(AbortSignal)
    )
  })

  it('publishes video and reel variants without conflating share-to-feed semantics', async () => {
    mocks.resolveInstagramMedia.mockImplementation(async ({ role }: { role: string }) => ({
      media:
        role === 'cover'
          ? { url: 'https://signed.example/cover.jpg', kind: 'image' }
          : { url: 'https://signed.example/video.mp4', kind: 'video' },
    }))

    await executeInstagramTool(
      request('instagram_publish_video', {
        accessToken: 'token',
        video,
        cover: image,
        caption: 'Video caption',
      })
    )
    expect(mocks.createMediaContainer).toHaveBeenLastCalledWith(
      'token',
      'ig-user-1',
      {
        media_type: 'REELS',
        video_url: 'https://signed.example/video.mp4',
        share_to_feed: true,
        caption: 'Video caption',
        cover_url: 'https://signed.example/cover.jpg',
      },
      expect.any(AbortSignal)
    )

    vi.clearAllMocks()
    mocks.resolveIgUserId.mockResolvedValue('ig-user-1')
    mocks.createMediaContainer.mockResolvedValue('container-1')
    mocks.waitForContainerReady.mockResolvedValue({ statusCode: 'FINISHED', status: null })
    mocks.publishMediaContainer.mockResolvedValue('media-1')
    mocks.resolveInstagramMedia.mockResolvedValue({
      media: { url: 'https://signed.example/video.mp4', kind: 'video' },
    })
    await executeInstagramTool(
      request('instagram_publish_reel', {
        accessToken: 'token',
        video,
        shareToFeed: false,
        thumbOffset: 0,
      })
    )
    expect(mocks.createMediaContainer).toHaveBeenLastCalledWith(
      'token',
      'ig-user-1',
      {
        media_type: 'REELS',
        video_url: 'https://signed.example/video.mp4',
        share_to_feed: false,
        thumb_offset: 0,
      },
      expect.any(AbortSignal)
    )
  })

  it('selects the correct story URL field from resolved media kind', async () => {
    mocks.resolveInstagramMedia.mockResolvedValue({
      media: { url: 'https://signed.example/story.mp4', kind: 'video' },
    })

    await executeInstagramTool(
      request('instagram_publish_story', { accessToken: 'token', media: video })
    )

    expect(mocks.createMediaContainer).toHaveBeenCalledWith(
      'token',
      'ig-user-1',
      { media_type: 'STORIES', video_url: 'https://signed.example/story.mp4' },
      expect.any(AbortSignal)
    )
  })

  it('creates ordered carousel children before the parent container', async () => {
    mocks.resolveInstagramCarouselMedia.mockResolvedValue({
      items: [
        { url: 'https://signed.example/one.jpg', kind: 'image' },
        { url: 'https://signed.example/two.mp4', kind: 'video' },
      ],
    })
    mocks.createMediaContainer
      .mockResolvedValueOnce('child-1')
      .mockResolvedValueOnce('child-2')
      .mockResolvedValueOnce('parent-1')

    const response = await executeInstagramTool(
      request('instagram_publish_carousel', {
        accessToken: 'token',
        media: [image, video],
        caption: 'Carousel caption',
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.createMediaContainer.mock.calls.map((call) => call[2])).toEqual([
      { is_carousel_item: true, image_url: 'https://signed.example/one.jpg' },
      {
        is_carousel_item: true,
        media_type: 'VIDEO',
        video_url: 'https://signed.example/two.mp4',
      },
      { media_type: 'CAROUSEL', children: 'child-1,child-2', caption: 'Carousel caption' },
    ])
  })

  it('propagates cancellation without returning a provider retry error', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      executeInstagramTool(
        request('instagram_publish_image', { accessToken: 'token', image }, controller.signal)
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
