/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUploadExecutionFile } = vi.hoisted(() => ({
  mockUploadExecutionFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mockUploadExecutionFile,
}))

import { filesTool } from '@/tools/typeform/files'

describe('Typeform files tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      name: 'upload.pdf',
      size: 7,
      type: 'application/pdf',
      url: '/api/files/serve/execution/file-1',
      key: 'execution/workflow/file-1',
      context: 'execution',
    })
  })

  it('stores downloaded files as execution file references', async () => {
    const response = new Response('content', {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="upload.pdf"',
      },
    })

    const result = await filesTool.transformResponse?.(response, {
      formId: 'form-1',
      responseId: 'response-1',
      fieldId: 'field-1',
      filename: 'upload.pdf',
      apiKey: 'token',
      _context: {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        userId: 'user-1',
      },
    })

    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' },
      Buffer.from('content'),
      'upload.pdf',
      'application/pdf',
      'user-1'
    )
    expect(result?.output.file).toMatchObject({
      key: 'execution/workflow/file-1',
      context: 'execution',
      mimeType: 'application/pdf',
    })
    expect(result?.output.file).not.toHaveProperty('data')
  })

  it('preserves legacy base64 data when execution context is unavailable', async () => {
    const bytes = Uint8Array.from([0, 255, 1, 254])
    const response = new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="upload.pdf"',
      },
    })

    const result = await filesTool.transformResponse?.(response, {
      formId: 'form-1',
      responseId: 'response-1',
      fieldId: 'field-1',
      filename: 'upload.pdf',
      apiKey: 'token',
    })

    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
    expect(result?.output.file).toMatchObject({
      name: 'upload.pdf',
      mimeType: 'application/pdf',
      data: Buffer.from(bytes).toString('base64'),
      size: bytes.byteLength,
    })
  })

  it('rejects large downloads when execution context is unavailable', async () => {
    const response = new Response(new Uint8Array(8 * 1024 * 1024), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="upload.pdf"',
      },
    })

    await expect(
      filesTool.transformResponse?.(response, {
        formId: 'form-1',
        responseId: 'response-1',
        fieldId: 'field-1',
        filename: 'upload.pdf',
        apiKey: 'token',
      })
    ).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
      label: 'Typeform legacy inline file',
    })
  })
})
