/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteTikTokUploadVideoDraft } = vi.hoisted(() => ({
  mockExecuteTikTokUploadVideoDraft: vi.fn(),
}))

vi.mock('@/lib/internal/tiktok/operations', () => ({
  executeTikTokUploadVideoDraft: mockExecuteTikTokUploadVideoDraft,
}))

import { executeTikTokTool } from '@/lib/internal/tiktok/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const FILE = {
  key: 'workspace/workspace-1/video.mp4',
  name: 'video.mp4',
  size: 1,
  type: 'video/mp4',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'tiktok_upload_video_draft',
    input: { accessToken: 'access-token', file: FILE },
    headers: new Headers(),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeTikTokTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteTikTokUploadVideoDraft.mockResolvedValue(Response.json({ success: true }))
  })

  it('dispatches typed input with trusted identity', async () => {
    const response = await executeTikTokTool(createRequest())

    expect(response.status).toBe(200)
    expect(mockExecuteTikTokUploadVideoDraft).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-token', file: FILE }),
      { userId: 'user-1', requestId: 'request-1', signal: undefined }
    )
  })

  it('requires trusted execution identity', async () => {
    const response = await executeTikTokTool(
      createRequest({
        context: { workflowId: 'workflow-1', workspaceId: 'workspace-1', metadata: {} },
      })
    )

    expect(response.status).toBe(401)
    expect(mockExecuteTikTokUploadVideoDraft).not.toHaveBeenCalled()
  })
})
