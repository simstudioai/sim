/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  secureFetchWithPinnedIP: vi.fn(),
  validateUrlWithDNS: vi.fn(),
  uploadCopilotFile: vi.fn(),
  uploadExecutionFile: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

vi.mock('@/lib/uploads/contexts/copilot', () => ({
  uploadCopilotFile: mocks.uploadCopilotFile,
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecutionFile,
}))

import { exportGoogleSlidesPresentation } from '@/lib/internal/google-slides/operations'

describe('exportGoogleSlidesPresentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mocks.secureFetchWithPinnedIP.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    )
    mocks.uploadExecutionFile.mockResolvedValue({
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

    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledWith(
      expect.stringContaining('/drive/v3/files/presentation-1/export?'),
      '203.0.113.1',
      expect.objectContaining({ signal: controller.signal })
    )
    expect(mocks.uploadExecutionFile).toHaveBeenCalledWith(
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
