import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { uploadsCopilotMock, uploadsCopilotMockFns } from '@sim/testing/mocks/uploads-copilot.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readGraph: vi.fn(),
  uploadMedia: vi.fn(),
}))

vi.mock('@/lib/internal/whatsapp/client', () => ({
  readWhatsAppGraphResponse: mocks.readGraph,
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)

vi.mock('@/lib/uploads/contexts/copilot', () => uploadsCopilotMock)

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

vi.mock('@/lib/internal/whatsapp/upload', () => ({
  uploadWhatsAppMedia: mocks.uploadMedia,
}))

import { executeWhatsAppGetMedia } from '@/lib/internal/whatsapp/operations'

const { mockUploadCopilotFile } = uploadsCopilotMockFns

const { mockUploadExecutionFile } = uploadsExecutionMockFns

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns
const { mockGetExtensionFromMimeType } = fileUtilsMockFns

const input = { accessToken: ' token ', mediaId: 'media-id', phoneNumberId: 'phone-id' }
const storedFile = {
  key: 'workspace/file',
  name: 'whatsapp-media-id.jpg',
  size: 3,
  type: 'image/jpeg',
}

describe('WhatsApp media operations', () => {
  beforeEach(() => {
    mockGetExtensionFromMimeType.mockReturnValue('jpg')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    mocks.readGraph.mockResolvedValue({
      url: 'https://cdn.example.com/media',
      mime_type: 'image/jpeg',
      file_size: '3',
      sha256: 'hash',
      id: 'media-id',
    })
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mockSecureFetchWithPinnedIP.mockResolvedValue(new Response('abc'))
    mockUploadExecutionFile.mockResolvedValue(storedFile)
    mockUploadCopilotFile.mockResolvedValue(storedFile)
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
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
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
    expect(mockUploadCopilotFile).not.toHaveBeenCalled()
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
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
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
  })
})
