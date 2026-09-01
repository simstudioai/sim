/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteFirefliesUploadAudio } = vi.hoisted(() => ({
  mockExecuteFirefliesUploadAudio: vi.fn(),
}))

vi.mock('@/lib/internal/fireflies/operations', () => ({
  executeFirefliesUploadAudio: mockExecuteFirefliesUploadAudio,
}))

import { executeFirefliesTool } from '@/lib/internal/fireflies/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'fireflies_upload_audio',
    input: {
      apiKey: 'fireflies-key',
      audioUrl: 'https://media.example.com/audio.mp3',
    },
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

describe('executeFirefliesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteFirefliesUploadAudio.mockResolvedValue(Response.json({ data: {} }))
  })

  it('validates and dispatches the typed operation input', async () => {
    const request = createRequest()
    const response = await executeFirefliesTool(request)

    expect(response.status).toBe(200)
    expect(mockExecuteFirefliesUploadAudio).toHaveBeenCalledWith(request.input, {
      headers: request.headers,
      userId: 'user-1',
      requestId: 'request-1',
      signal: undefined,
    })
  })

  it('rejects missing audio before provider work', async () => {
    const response = await executeFirefliesTool(
      createRequest({ input: { apiKey: 'fireflies-key' } })
    )

    expect(response.status).toBe(400)
    expect(mockExecuteFirefliesUploadAudio).not.toHaveBeenCalled()
  })

  it('requires trusted execution identity', async () => {
    const response = await executeFirefliesTool(
      createRequest({
        context: { workflowId: 'workflow-1', workspaceId: 'workspace-1', metadata: {} },
      })
    )

    expect(response.status).toBe(401)
    expect(mockExecuteFirefliesUploadAudio).not.toHaveBeenCalled()
  })
})
