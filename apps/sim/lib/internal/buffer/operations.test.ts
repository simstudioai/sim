import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

const { mockResolveFileInputToUrl } = fileUtilsServerMockFns

import { executeBufferTool } from '@/lib/internal/buffer/execute-tool'
import { createBufferPost } from '@/lib/internal/buffer/operations'
import bufferPostFixture from '@/tools/buffer/__fixtures__/post.json'

describe('Buffer operations', () => {
  it('creates a text post when optional assets are null', async () => {
    const providerInputs: Record<string, unknown>[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body: { variables: { input: Record<string, unknown> } } = JSON.parse(String(init?.body))
      providerInputs.push(body.variables.input)
      return Response.json({
        data: { createPost: { __typename: 'PostActionSuccess', post: bufferPostFixture } },
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
        data: { editPost: { __typename: 'PostActionSuccess', post: bufferPostFixture } },
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

  it.each([
    { assets: null, status: 200 },
    { assets: [], status: 400 },
  ])(
    'attaches edit media with absent assets but rejects explicit assets: $assets',
    async ({ assets, status }) => {
      mockResolveFileInputToUrl.mockResolvedValueOnce({
        fileUrl: 'https://files.example/image.png',
      })
      const providerInputs: Record<string, unknown>[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
        const body: { variables: { input: Record<string, unknown> } } = JSON.parse(
          String(init?.body)
        )
        providerInputs.push(body.variables.input)
        return Response.json({
          data: { editPost: { __typename: 'PostActionSuccess', post: bufferPostFixture } },
        })
      })

      const response = await executeBufferTool({
        toolId: 'buffer_edit_post',
        input: {
          apiKey: 'buffer-key',
          postId: 'post-1',
          media: { key: 'workspace/ws/file-1', name: 'image.png', size: 1, type: 'image/png' },
          assets,
        },
        headers: new Headers(),
        context: { workflowId: 'workflow-1', userId: 'user-1' },
        requestId: 'request-1',
      })

      expect(response.status).toBe(status)
      expect(providerInputs).toEqual(
        status === 200
          ? [{ id: 'post-1', assets: [{ image: { url: 'https://files.example/image.png' } }] }]
          : []
      )
    }
  )

  it.each([
    { field: 'channel', value: null, path: 'Post.channel' },
    { field: 'text', value: null, path: 'Post.text' },
    { field: 'assets', value: null, path: 'Post.assets' },
    { field: 'tags', value: [null], path: 'Post.tags[]' },
  ])(
    'rejects null in required provider response positions: $path',
    async ({ field, value, path }) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        Response.json({
          data: {
            editPost: {
              __typename: 'PostActionSuccess',
              post: { ...bufferPostFixture, [field]: value },
            },
          },
        })
      )
      const response = await executeBufferTool({
        toolId: 'buffer_edit_post',
        input: { apiKey: 'buffer-key', postId: 'post-1', text: 'Updated caption' },
        headers: new Headers(),
        context: { workflowId: 'workflow-1', userId: 'user-1' },
        requestId: 'request-1',
      })
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        success: false,
        error: `Buffer returned null for ${path}`,
      })
    }
  )

  it.each([
    { corruption: { text: 42 }, error: 'Post.text must be a string' },
    {
      corruption: { isCustomScheduled: 'false' },
      error: 'Post.isCustomScheduled must be a boolean',
    },
    { corruption: { allowedActions: [42] }, error: 'Post.allowedActions[] must be a string' },
    { corruption: { status: 'invalid-status' }, error: 'Post.status must be one of' },
    {
      corruption: { allowedActions: ['invalid-action'] },
      error: 'Post.allowedActions[] must be one of',
    },
    {
      corruption: {
        channel: {
          ...bufferPostFixture.channel,
          weeklyPostingLimit: { limit: 1.5, scheduled: 0, sent: 0 },
        },
      },
      error: 'WeeklyPostingLimit.limit must be an integer',
    },
  ])('rejects malformed provider scalar values: $error', async ({ corruption, error }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        data: {
          editPost: {
            __typename: 'PostActionSuccess',
            post: { ...bufferPostFixture, ...corruption },
          },
        },
      })
    )
    const response = await executeBufferTool({
      toolId: 'buffer_edit_post',
      input: { apiKey: 'buffer-key', postId: 'post-1', text: 'Updated caption' },
      headers: new Headers(),
      context: { workflowId: 'workflow-1', userId: 'user-1' },
      requestId: 'request-1',
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining(`Buffer response ${error}`),
    })
  })

  it('resolves stored media with trusted user context before the provider call', async () => {
    mockResolveFileInputToUrl.mockResolvedValue({ fileUrl: 'https://files.example/image.png' })
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          createPost: {
            __typename: 'PostActionSuccess',
            post: bufferPostFixture,
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
