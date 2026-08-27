/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getZohoDeskAttachment: vi.fn() }))

vi.mock('@/lib/internal/zoho-desk/operations', () => ({
  getZohoDeskAttachment: mocks.getZohoDeskAttachment,
  MAX_ZOHO_DESK_ATTACHMENT_BYTES: 7 * 1024 * 1024,
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
    mocks.getZohoDeskAttachment.mockResolvedValue({
      success: true,
      output: { file: { name: 'file.pdf', mimeType: 'application/pdf', data: 'YQ==' } },
    })
  })

  it('dispatches the typed operation with cancellation', async () => {
    const controller = new AbortController()
    const response = await executeZohoDeskTool(request({ signal: controller.signal }))

    expect(response.status).toBe(200)
    expect(mocks.getZohoDeskAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1' }),
      { signal: controller.signal }
    )
  })

  it('preserves operation status', async () => {
    mocks.getZohoDeskAttachment.mockRejectedValue(
      new ZohoDeskOperationError('Invalid attachment href', 400)
    )
    const response = await executeZohoDeskTool(request())
    expect(response.status).toBe(400)
  })
})
