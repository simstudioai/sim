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

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

vi.mock('@/lib/uploads/contexts/copilot', () => uploadsCopilotMock)

vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import { exportGoogleSlidesPresentation } from '@/lib/internal/google-slides/operations'

const { mockUploadCopilotFile } = uploadsCopilotMockFns

const { mockUploadExecutionFile } = uploadsExecutionMockFns

describe('exportGoogleSlidesPresentation', () => {
  beforeEach(() => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mockSecureFetchWithPinnedIP.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    )
    mockUploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      name: 'presentation-1.pdf',
      url: '/api/files/serve/file-1',
    })
  })

  it('pins the provider request and stores output in execution scope', async () => {
    const controller = new AbortController()
    const result = await exportGoogleSlidesPresentation(
      { accessToken: 'token', presentationId: 'presentation-1', exportFormat: 'PDF' },
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        signal: controller.signal,
      }
    )

    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      expect.stringContaining('/drive/v3/files/presentation-1/export?'),
      '203.0.113.1',
      expect.objectContaining({ signal: controller.signal })
    )
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      expect.any(Buffer),
      'presentation-1.pdf',
      'application/pdf',
      'user-1'
    )
    expect(result.output.file).toEqual(
      expect.objectContaining({ id: 'file-1', mimeType: 'application/pdf' })
    )
    expect(result.output.contentBase64).toBe('AQID')
  })
})
