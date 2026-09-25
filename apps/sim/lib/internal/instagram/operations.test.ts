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
  mocks.resolveIgUserId.mockImplementation(async (_token: string, override?: string) => {
    return override || 'ig-user-1'
  })
  mocks.createMediaContainer.mockResolvedValue('container-1')
  mocks.waitForContainerReady.mockResolvedValue({ statusCode: 'FINISHED', status: null })
  mocks.publishMediaContainer.mockResolvedValue('media-1')
})

describe('Instagram operation declarations', () => {
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
})
