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

import { exportPresentationTool } from '@/tools/google_slides/export_presentation'
import { transformGoogleSlidesExportResponse } from '@/tools/google_slides/export_presentation.server'

describe('Google Slides export presentation tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      name: 'presentation-1.pdf',
      size: 7,
      type: 'application/pdf',
      url: '/api/files/serve/execution/file-1',
      key: 'execution/workflow/file-1',
      context: 'execution',
    })
  })

  it('stores exports as execution file references instead of base64', async () => {
    const response = new Response('content', {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    })

    const result = await transformGoogleSlidesExportResponse(response, {
      accessToken: 'token',
      presentationId: 'presentation-1',
      exportFormat: 'PDF',
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
      'presentation-1.pdf',
      'application/pdf',
      'user-1'
    )
    expect(result?.output.file).toMatchObject({
      key: 'execution/workflow/file-1',
      context: 'execution',
      mimeType: 'application/pdf',
    })
    expect(result?.output.contentBase64).toBeUndefined()
  })

  it('preserves legacy base64 content when execution context is unavailable', async () => {
    const bytes = Uint8Array.from([0, 255, 1, 254])
    const response = new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    })

    const result = await exportPresentationTool.transformResponse?.(response, {
      accessToken: 'token',
      presentationId: 'presentation-1',
      exportFormat: 'PDF',
    })

    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
    expect(result?.output.file).toBeUndefined()
    expect(result?.output.contentBase64).toBe(Buffer.from(bytes).toString('base64'))
    expect(result?.output.sizeBytes).toBe(bytes.byteLength)
  })
})
