import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

const { mockResolveFileInputToUrl } = fileUtilsServerMockFns

import { executeBufferTool } from '@/lib/internal/buffer/execute-tool'
import { createBufferPost } from '@/lib/internal/buffer/operations'

describe('Buffer operations', () => {
  it('creates a text post when optional assets are null', async () => {
    const providerInputs: Record<string, unknown>[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body: { variables: { input: Record<string, unknown> } } = JSON.parse(String(init?.body))
      providerInputs.push(body.variables.input)
      return Response.json({
        data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'post-1' } } },
      })
    })

    const response = await executeBufferTool({
      toolId: 'buffer_create_post',
      input: {
        apiKey: 'buffer-key',
        channelId: 'channel-1',
        mode: 'addToQueue',
        text: 'Caption',
        assets: null,
      },
      headers: new Headers(),
      context: { workflowId: 'workflow-1', userId: 'user-1' },
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    expect(providerInputs).toEqual([
      {
        channelId: 'channel-1',
        mode: 'addToQueue',
        schedulingType: 'automatic',
        text: 'Caption',
        assets: [],
        needsApproval: false,
      },
    ])
  })

  it.each([
    { scheduling: {}, expected: {} },
    { scheduling: { mode: null, schedulingType: null }, expected: {} },
    {
      scheduling: { mode: 'customScheduled', dueAt: '2026-11-01T15:00:00Z' },
      expected: { mode: 'customScheduled', dueAt: '2026-11-01T15:00:00Z' },
    },
    {
      scheduling: { mode: 'shareNow', schedulingType: 'notification' },
      expected: { mode: 'shareNow', schedulingType: 'notification' },
    },
  ])('changes scheduling only when requested: $scheduling', async ({ scheduling, expected }) => {
    const providerInputs: Record<string, unknown>[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body: { variables: { input: Record<string, unknown> } } = JSON.parse(String(init?.body))
      providerInputs.push(body.variables.input)
      return Response.json({
        data: { editPost: { __typename: 'PostActionSuccess', post: { id: 'post-1' } } },
      })
    })

    const response = await executeBufferTool({
      toolId: 'buffer_edit_post',
      input: { apiKey: 'buffer-key', postId: 'post-1', text: 'Updated caption', ...scheduling },
      headers: new Headers(),
      context: { workflowId: 'workflow-1', userId: 'user-1' },
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    expect(providerInputs).toEqual([{ id: 'post-1', text: 'Updated caption', ...expected }])
  })

  it('resolves stored media with trusted user context before the provider call', async () => {
    mockResolveFileInputToUrl.mockResolvedValue({ fileUrl: 'https://files.example/image.png' })
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

    expect(mockResolveFileInputToUrl).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', presignExpirySeconds: 604800 })
    )
    const request = fetchMock.mock.calls[0][1]
    expect(JSON.parse(request.body).variables.input.assets).toEqual([
      { image: { url: 'https://files.example/image.png' } },
    ])
  })
})
