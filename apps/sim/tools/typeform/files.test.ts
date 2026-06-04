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

import { POST } from '@/app/api/tools/typeform/files/route'
import { filesTool } from '@/tools/typeform/files'
import type { TypeformFilesParams } from '@/tools/typeform/types'

describe('Typeform files tool', () => {
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
      originalHostname: 'api.typeform.com',
    })
    mockUploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      name: 'upload.pdf',
      size: 7,
      type: 'application/pdf',
      url: '/api/files/serve/execution/file-1',
      key: 'execution/workflow/file-1',
      context: 'execution',
    })
    mockUploadCopilotFile.mockResolvedValue({
      id: 'copilot-file-1',
      name: 'upload.pdf',
      size: 4,
      type: 'application/pdf',
      mimeType: 'application/pdf',
      url: '/api/files/serve/copilot/copilot-file-1',
      key: 'copilot/copilot-file-1',
      context: 'copilot',
    })
  })

  it('routes file downloads through the internal API with execution context', () => {
    const params: TypeformFilesParams = {
      formId: 'form-1',
      responseId: 'response-1',
      fieldId: 'field-1',
      filename: 'upload.pdf',
      apiKey: 'token',
      _context: {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    }

    expect(filesTool.request.url).toBe('/api/tools/typeform/files')
    expect(filesTool.request.method).toBe('POST')
    expect(filesTool.request.body?.(params)).toEqual({
      formId: 'form-1',
      responseId: 'response-1',
      fieldId: 'field-1',
      filename: 'upload.pdf',
      inline: undefined,
      apiKey: 'token',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
  })

  it('stores downloaded files as execution file references', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      new Response('content', {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="upload.pdf"',
        },
      })
    )

    const response = await POST(
      createMockRequest('POST', {
        formId: 'form-1',
        responseId: 'response-1',
        fieldId: 'field-1',
        filename: 'upload.pdf',
        apiKey: 'token',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
    )
    const result = (await response.json()) as {
      success: true
      output: { file: { key: string; context: string; mimeType: string } }
    }

    expect(response.status).toBe(200)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://api.typeform.com/forms/form-1/responses/response-1/fields/field-1/files/upload.pdf',
      '93.184.216.34',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token' },
        maxResponseBytes: 10 * 1024 * 1024,
      })
    )
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' },
      Buffer.from('content'),
      'upload.pdf',
      'application/pdf',
      'user-1'
    )
    expect(result.output.file).toMatchObject({
      key: 'execution/workflow/file-1',
      context: 'execution',
      mimeType: 'application/pdf',
    })
    expect(result.output.file).not.toHaveProperty('data')
  })

  it('stores downloads in copilot storage when execution context is unavailable', async () => {
    const bytes = Uint8Array.from([0, 255, 1, 254])
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      new Response(bytes, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="upload.pdf"',
        },
      })
    )

    const response = await POST(
      createMockRequest('POST', {
        formId: 'form-1',
        responseId: 'response-1',
        fieldId: 'field-1',
        filename: 'upload.pdf',
        apiKey: 'token',
      })
    )
    const result = (await response.json()) as {
      success: true
      output: { file: { key: string; context: string; url: string; size: number } }
    }

    expect(response.status).toBe(200)
    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
    expect(mockUploadCopilotFile).toHaveBeenCalledWith({
      buffer: Buffer.from(bytes),
      fileName: 'upload.pdf',
      contentType: 'application/pdf',
      userId: 'user-1',
    })
    expect(result.output.file).toMatchObject({
      key: 'copilot/copilot-file-1',
      context: 'copilot',
      url: '/api/files/serve/copilot/copilot-file-1',
      size: 4,
    })
  })

  it('stores large downloads in copilot storage when execution context is unavailable', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      new Response(new Uint8Array(8 * 1024 * 1024), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="upload.pdf"',
        },
      })
    )

    const response = await POST(
      createMockRequest('POST', {
        formId: 'form-1',
        responseId: 'response-1',
        fieldId: 'field-1',
        filename: 'upload.pdf',
        apiKey: 'token',
      })
    )
    const result = (await response.json()) as {
      success: true
      output: { file: { key: string; context: string } }
    }

    expect(response.status).toBe(200)
    expect(mockUploadCopilotFile).toHaveBeenCalled()
    expect(result.output.file).toMatchObject({
      key: 'copilot/copilot-file-1',
      context: 'copilot',
    })
  })

  it('maps internal API responses into tool output', async () => {
    const response = new Response(
      JSON.stringify({
        success: true,
        output: {
          fileUrl: '/api/files/serve/execution/file-1',
          file: { name: 'upload.pdf', mimeType: 'application/pdf', data: 'abc', size: 3 },
          contentType: 'application/pdf',
          filename: 'upload.pdf',
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    )

    const result = await filesTool.transformResponse?.(response)

    expect(result?.output.filename).toBe('upload.pdf')
    expect(result?.output.fileUrl).toBe('/api/files/serve/execution/file-1')
  })
})
