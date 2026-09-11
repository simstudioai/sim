/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { createInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const mocks = vi.hoisted(() => ({ getZohoDeskAttachment: vi.fn() }))

vi.mock('@/lib/internal/zoho-desk/operations', () => ({
  getZohoDeskAttachment: mocks.getZohoDeskAttachment,
}))

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { ZohoDeskOperationError } from '@/lib/internal/zoho-desk/errors'
import { executeZohoDeskTool } from '@/lib/internal/zoho-desk/execute-tool'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'zoho_desk_get_attachment',
    input: {
      accessToken: 'token',
      orgId: 'org-1',
      href: 'https://desk.zoho.com/api/v1/tickets/1/attachments/2/content',
    },
    headers: new Headers(),
    context: createExecutionContext({ workflowId: 'workflow-1' }),
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeZohoDeskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches the typed operation with cancellation', async () => {
    const controller = new AbortController()
    const result = createInternalToolFileResult(
      { buffer: Buffer.alloc(12 * 1024 * 1024), name: 'file.pdf', mimeType: 'application/pdf' },
      (file) => ({ success: true, output: { file } })
    )
    mocks.getZohoDeskAttachment.mockResolvedValue(result)

    expect(await executeZohoDeskTool(request({ signal: controller.signal }))).toBe(result)
    expect(mocks.getZohoDeskAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1' }),
      { signal: controller.signal }
    )
  })

  it('projects the buffered file limit as 413', async () => {
    mocks.getZohoDeskAttachment.mockRejectedValue(
      new PayloadSizeLimitError({
        label: 'Zoho Desk attachment',
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
        observedBytes: MAX_BUFFERED_TRANSFER_BYTES + 1,
      })
    )
    const response = await executeZohoDeskTool(request())
    if (!(response instanceof Response)) throw new Error('Expected an error response')
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Attachment exceeds the 100 MB download limit',
    })
  })

  it('preserves operation status', async () => {
    mocks.getZohoDeskAttachment.mockRejectedValue(
      new ZohoDeskOperationError('Invalid attachment href', 400)
    )
    const response = await executeZohoDeskTool(request())
    if (!(response instanceof Response)) throw new Error('Expected an error response')
    expect(response.status).toBe(400)
  })
})
