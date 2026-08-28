/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteSupabaseStorageUpload } = vi.hoisted(() => ({
  mockExecuteSupabaseStorageUpload: vi.fn(),
}))

vi.mock('@/lib/internal/supabase/operations', () => ({
  executeSupabaseStorageUpload: mockExecuteSupabaseStorageUpload,
}))

import { executeSupabaseTool } from '@/lib/internal/supabase/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const INPUT = {
  projectId: 'project1234',
  apiKey: 'service-key',
  bucket: 'documents',
  fileName: 'hello.txt',
  fileData: 'hello',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'supabase_storage_upload',
    input: INPUT,
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

describe('executeSupabaseTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteSupabaseStorageUpload.mockResolvedValue(Response.json({ success: true }))
  })

  it('validates and dispatches operation input with trusted identity', async () => {
    const response = await executeSupabaseTool(createRequest())

    expect(response.status).toBe(200)
    expect(mockExecuteSupabaseStorageUpload).toHaveBeenCalledWith(
      { ...INPUT, path: undefined, contentType: undefined, cacheControl: undefined, upsert: false },
      { userId: 'user-1', requestId: 'request-1', signal: undefined }
    )
  })

  it('rejects malformed input before provider work', async () => {
    const response = await executeSupabaseTool(createRequest({ input: { ...INPUT, bucket: '' } }))

    expect(response.status).toBe(400)
    expect(mockExecuteSupabaseStorageUpload).not.toHaveBeenCalled()
  })

  it('requires trusted execution identity', async () => {
    const response = await executeSupabaseTool(
      createRequest({
        context: { workflowId: 'workflow-1', workspaceId: 'workspace-1', metadata: {} },
      })
    )

    expect(response.status).toBe(401)
    expect(mockExecuteSupabaseStorageUpload).not.toHaveBeenCalled()
  })
})
