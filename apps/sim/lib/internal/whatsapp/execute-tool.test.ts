/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMedia: vi.fn(),
  sendMedia: vi.fn(),
  uploadMedia: vi.fn(),
}))

vi.mock('@/lib/internal/whatsapp/operations', () => ({
  executeWhatsAppGetMedia: mocks.getMedia,
  executeWhatsAppSendMedia: mocks.sendMedia,
  executeWhatsAppUploadMedia: mocks.uploadMedia,
}))

import { executeWhatsAppTool } from '@/lib/internal/whatsapp/execute-tool'
import { getMediaTool } from '@/tools/whatsapp/get_media'
import { sendMediaTool } from '@/tools/whatsapp/send_media'
import { uploadMediaTool } from '@/tools/whatsapp/upload_media'

const auth = { accessToken: 'token', phoneNumberId: 'phone-id' }

describe('WhatsApp internal tool execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const execute of Object.values(mocks)) {
      execute.mockResolvedValue(Response.json({ success: true, output: {} }))
    }
  })

  it.each([
    ['whatsapp_get_media', { ...auth, mediaId: 'media-id' }, mocks.getMedia],
    [
      'whatsapp_send_media',
      { ...auth, phoneNumber: '+14155550100', mediaType: 'image', mediaId: 'media-id' },
      mocks.sendMedia,
    ],
    [
      'whatsapp_upload_media',
      {
        ...auth,
        file: { key: 'workspace/file', name: 'image.png', size: 4, type: 'image/png' },
      },
      mocks.uploadMedia,
    ],
  ])('dispatches %s with trusted execution scope', async (toolId, input, execute) => {
    await executeWhatsAppTool({
      toolId,
      input,
      headers: new Headers(),
      context: {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      requestId: 'request-1',
    })

    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0][1]).toMatchObject({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      requestId: 'request-1',
    })
  })

  it('rejects unauthenticated direct execution', async () => {
    const response = await executeWhatsAppTool({
      toolId: 'whatsapp_get_media',
      input: { ...auth, mediaId: 'media-id' },
      headers: new Headers(),
      context: {},
      requestId: 'request-1',
    })

    expect(response.status).toBe(401)
    expect(mocks.getMedia).not.toHaveBeenCalled()
  })

  it('uses operation-only declarations', () => {
    for (const tool of [getMediaTool, sendMediaTool, uploadMediaTool]) {
      expect(tool.operation).toBeDefined()
      expect('request' in tool).toBe(false)
    }
  })
})
