/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ uploadWordPressMedia: vi.fn() }))

vi.mock('@/lib/internal/wordpress/operations', () => ({
  uploadWordPressMedia: mocks.uploadWordPressMedia,
}))

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { executeWordPressTool } from '@/lib/internal/wordpress/execute-tool'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'wordpress_upload_media',
    input: {
      accessToken: 'token',
      siteId: 'site-1',
      file: { key: 'workspace/ws/file-1', name: 'image.png', size: 3, type: 'image/png' },
    },
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeWordPressTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadWordPressMedia.mockResolvedValue({
      success: true,
      output: { media: { id: 1 } },
    })
  })

  it('uses trusted user identity and operation cancellation', async () => {
    const controller = new AbortController()
    const response = await executeWordPressTool(request({ signal: controller.signal }))

    expect(response.status).toBe(200)
    expect(mocks.uploadWordPressMedia).toHaveBeenCalledWith(expect.any(Object), {
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })
  })

  it('rejects missing trusted identity before file work', async () => {
    const response = await executeWordPressTool(
      request({ context: createExecutionContext({ workflowId: 'workflow-1' }) })
    )
    expect(response.status).toBe(401)
    expect(mocks.uploadWordPressMedia).not.toHaveBeenCalled()
  })
})
