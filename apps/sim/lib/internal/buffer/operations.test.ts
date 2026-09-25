import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveFileInputToUrl: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  resolveFileInputToUrl: mocks.resolveFileInputToUrl,
}))

import { createBufferPost } from '@/lib/internal/buffer/operations'

describe('Buffer operations', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves stored media with trusted user context before the provider call', async () => {
    mocks.resolveFileInputToUrl.mockResolvedValue({ fileUrl: 'https://files.example/image.png' })
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          createPost: {
            __typename: 'PostActionSuccess',
            post: { id: 'post-1' },
          },
        },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await createBufferPost(
      {
        apiKey: 'buffer-key',
        channelId: 'channel-1',
        mode: 'addToQueue',
        schedulingType: 'automatic',
        mediaType: 'auto',
        media: { key: 'workspace/ws/file-1', name: 'image.png', type: 'image/png' },
      },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(mocks.resolveFileInputToUrl).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', presignExpirySeconds: 604800 })
    )
    const request = fetchMock.mock.calls[0][1]
    expect(JSON.parse(request.body).variables.input.assets).toEqual([
      { image: { url: 'https://files.example/image.png' } },
    ])
  })
})
