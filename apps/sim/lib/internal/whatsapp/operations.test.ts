/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readGraph: vi.fn(),
  validateUrl: vi.fn(),
  secureFetch: vi.fn(),
  uploadExecution: vi.fn(),
  uploadCopilot: vi.fn(),
  uploadMedia: vi.fn(),
}))

vi.mock('@/lib/internal/whatsapp/client', () => ({
  readWhatsAppGraphResponse: mocks.readGraph,
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateUrlWithDNS: mocks.validateUrl,
  secureFetchWithPinnedIP: mocks.secureFetch,
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecution,
}))

vi.mock('@/lib/uploads/contexts/copilot', () => ({
  uploadCopilotFile: mocks.uploadCopilot,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  getExtensionFromMimeType: () => 'jpg',
}))

vi.mock('@/lib/internal/whatsapp/upload', () => ({
  uploadWhatsAppMedia: mocks.uploadMedia,
}))

import { executeWhatsAppGetMedia } from '@/lib/internal/whatsapp/operations'

const input = { accessToken: ' token ', mediaId: 'media-id', phoneNumberId: 'phone-id' }
const storedFile = {
  key: 'workspace/file',
  name: 'whatsapp-media-id.jpg',
  size: 3,
  type: 'image/jpeg',
}

describe('WhatsApp media operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    mocks.readGraph.mockResolvedValue({
      url: 'https://cdn.example.com/media',
      mime_type: 'image/jpeg',
      file_size: '3',
      sha256: 'hash',
      id: 'media-id',
    })
    mocks.validateUrl.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.secureFetch.mockResolvedValue(new Response('abc'))
    mocks.uploadExecution.mockResolvedValue(storedFile)
    mocks.uploadCopilot.mockResolvedValue(storedFile)
  })

  it('stores downloads under the trusted execution scope, not serialized input', async () => {
    const controller = new AbortController()
    const response = await executeWhatsAppGetMedia(input, {
      userId: 'user-1',
      requestId: 'request-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      signal: controller.signal,
    })

    expect(response.status).toBe(200)
    expect(mocks.uploadExecution).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      Buffer.from('abc'),
      'whatsapp-media-id.jpg',
      'image/jpeg',
      'user-1'
    )
    expect(mocks.uploadCopilot).not.toHaveBeenCalled()
    expect(mocks.secureFetch).toHaveBeenCalledWith(
      'https://cdn.example.com/media',
      '203.0.113.10',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer token',
          'User-Agent': 'SimWhatsAppMedia/1.0',
        },
        maxResponseBytes: 100 * 1024 * 1024,
        signal: controller.signal,
        stripAuthOnRedirect: true,
      })
    )
  })

  it('rejects declared media over 100MB before contacting the CDN', async () => {
    mocks.readGraph.mockResolvedValue({
      url: 'https://cdn.example.com/media',
      mime_type: 'video/mp4',
      file_size: 100 * 1024 * 1024 + 1,
      id: 'media-id',
    })

    const response = await executeWhatsAppGetMedia(input, {
      userId: 'user-1',
      requestId: 'request-1',
    })

    expect(response.status).toBe(413)
    expect(mocks.secureFetch).not.toHaveBeenCalled()
    expect(mocks.uploadExecution).not.toHaveBeenCalled()
  })

  it('does no work when the execution is already canceled', async () => {
    const controller = new AbortController()
    controller.abort(new Error('execution canceled'))

    await expect(
      executeWhatsAppGetMedia(input, {
        userId: 'user-1',
        requestId: 'request-1',
        signal: controller.signal,
      })
    ).rejects.toThrow('execution canceled')
    expect(fetch).not.toHaveBeenCalled()
  })
})
