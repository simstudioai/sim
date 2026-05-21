/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUploadCopilotFile, mockUploadExecutionFile } = vi.hoisted(() => ({
  mockUploadCopilotFile: vi.fn(),
  mockUploadExecutionFile: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/uploads/contexts/copilot', () => ({
  uploadCopilotFile: mockUploadCopilotFile,
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mockUploadExecutionFile,
}))

import { POST } from '@/app/api/tools/google_slides/export-presentation/route'
import type { ExportPresentationParams } from '@/tools/google_slides/export_presentation'
import { exportPresentationTool } from '@/tools/google_slides/export_presentation'

describe('Google Slides export presentation tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '93.184.216.34',
      originalHostname: 'www.googleapis.com',
    })
    mockUploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      name: 'presentation-1.pdf',
      size: 7,
      type: 'application/pdf',
      url: '/api/files/serve/execution/file-1',
      key: 'execution/workflow/file-1',
      context: 'execution',
    })
    mockUploadCopilotFile.mockResolvedValue({
      id: 'copilot-file-1',
      name: 'presentation-1.pdf',
      size: 4,
      type: 'application/pdf',
      mimeType: 'application/pdf',
      url: '/api/files/serve/copilot/copilot-file-1',
      key: 'copilot/copilot-file-1',
      context: 'copilot',
    })
  })

  it('routes exports through the internal API with execution context', () => {
    const params: ExportPresentationParams = {
      accessToken: 'token',
      presentationId: 'presentation-1',
      exportFormat: 'PDF',
      _context: {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    }

    expect(exportPresentationTool.request.url).toBe('/api/tools/google_slides/export-presentation')
    expect(exportPresentationTool.request.method).toBe('POST')
    expect(exportPresentationTool.request.body?.(params)).toEqual({
      accessToken: 'token',
      presentationId: 'presentation-1',
      exportFormat: 'PDF',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
  })

  it('rejects presentation IDs that would break export URL structure', async () => {
    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'token',
        presentationId: 'abc?mimeType=evil',
        exportFormat: 'PDF',
      })
    )
    const result = (await response.json()) as { success: false; error: string }

    expect(response.status).toBe(400)
    expect(result.error).toContain('invalid characters')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('stores exports as execution file references and keeps small legacy base64 output', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      new Response('content', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })
    )

    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'token',
        presentationId: 'presentation-1',
        exportFormat: 'PDF',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
    )
    const result = (await response.json()) as {
      success: true
      output: {
        file: { key: string; context: string; mimeType?: string }
        contentBase64?: string
      }
    }

    expect(response.status).toBe(200)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/presentation-1/export?mimeType=application%2Fpdf',
      '93.184.216.34',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token' },
        maxResponseBytes: 10 * 1024 * 1024,
      })
    )
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' },
      Buffer.from('content'),
      'presentation-1.pdf',
      'application/pdf',
      'user-1'
    )
    expect(result?.output.file).toMatchObject({
      key: 'execution/workflow/file-1',
      context: 'execution',
      mimeType: 'application/pdf',
    })
    expect(result.output.contentBase64).toBe(Buffer.from('content').toString('base64'))
  })

  it('stores exports in copilot storage when execution context is unavailable', async () => {
    const bytes = Uint8Array.from([0, 255, 1, 254])
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })
    )

    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'token',
        presentationId: 'presentation-1',
        exportFormat: 'PDF',
      })
    )
    const result = (await response.json()) as {
      success: true
      output: {
        file: { key: string; context: string; url: string }
        contentBase64?: string
        sizeBytes: number
      }
    }

    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
    expect(mockUploadCopilotFile).toHaveBeenCalledWith({
      buffer: Buffer.from(bytes),
      fileName: 'presentation-1.pdf',
      contentType: 'application/pdf',
      userId: 'user-1',
    })
    expect(result.output.file).toMatchObject({
      key: 'copilot/copilot-file-1',
      context: 'copilot',
      url: '/api/files/serve/copilot/copilot-file-1',
    })
    expect(result.output.contentBase64).toBe(Buffer.from(bytes).toString('base64'))
    expect(result.output.sizeBytes).toBe(bytes.byteLength)
  })

  it('maps internal API responses into tool output', async () => {
    const response = new Response(
      JSON.stringify({
        success: true,
        output: {
          file: {
            key: 'copilot/copilot-file-1',
            context: 'copilot',
            url: '/api/files/serve/copilot/copilot-file-1',
          },
          mimeType: 'application/pdf',
          sizeBytes: 3,
          metadata: {
            presentationId: 'presentation-1',
            url: 'https://docs.google.com/presentation/d/presentation-1/edit',
            exportFormat: 'PDF',
          },
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    )

    const result = await exportPresentationTool.transformResponse?.(response)

    expect(result?.output.file?.key).toBe('copilot/copilot-file-1')
    expect(result?.output.metadata.presentationId).toBe('presentation-1')
  })
})
