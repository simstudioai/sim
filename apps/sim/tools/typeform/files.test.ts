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
vi.mock('@/lib/uploads/contexts/copilot', () => ({ uploadCopilotFile: mocks.uploadCopilotFile }))
vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecutionFile,
}))

import { downloadTypeformFile } from '@/lib/internal/typeform/operations'
import { filesTool } from '@/tools/typeform/files'

describe('Typeform file operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '93.184.216.34' })
    mocks.secureFetchWithPinnedIP.mockResolvedValue(
      new Response('content', {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="upload.pdf"',
        },
      })
    )
    mocks.uploadExecutionFile.mockResolvedValue({
      name: 'upload.pdf',
      url: '/api/files/serve/execution/file-1',
      key: 'execution/workflow/file-1',
      context: 'execution',
    })
    mocks.uploadCopilotFile.mockResolvedValue({
      name: 'upload.pdf',
      url: '/api/files/serve/copilot/file-1',
      key: 'copilot/file-1',
      context: 'copilot',
    })
  })

  it('declares typed input without caller-provided execution authority', () => {
    const input = filesTool.operation.input({
      formId: 'form-1',
      responseId: 'response-1',
      fieldId: 'field-1',
      filename: 'upload.pdf',
      apiKey: 'token',
    })
    expect(input).toEqual({
      formId: 'form-1',
      responseId: 'response-1',
      fieldId: 'field-1',
      filename: 'upload.pdf',
      inline: undefined,
      apiKey: 'token',
    })
    expect('request' in filesTool).toBe(false)
  })

  it('stores downloads with trusted execution scope', async () => {
    const controller = new AbortController()
    const result = await downloadTypeformFile(
      {
        formId: 'form-1',
        responseId: 'response-1',
        fieldId: 'field-1',
        filename: 'upload.pdf',
        apiKey: 'token',
      },
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        signal: controller.signal,
      }
    )

    expect(mocks.uploadExecutionFile).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' },
      Buffer.from('content'),
      'upload.pdf',
      'application/pdf',
      'user-1'
    )
    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledWith(
      expect.stringContaining('/forms/form-1/responses/response-1/'),
      '93.184.216.34',
      expect.objectContaining({ signal: controller.signal })
    )
    expect(result.output.file).toMatchObject({ context: 'execution' })
  })

  it('uses Copilot storage only when trusted execution scope is absent', async () => {
    const result = await downloadTypeformFile(
      {
        formId: 'form-1',
        responseId: 'response-1',
        fieldId: 'field-1',
        filename: 'upload.pdf',
        apiKey: 'token',
      },
      { userId: 'user-1' }
    )

    expect(mocks.uploadExecutionFile).not.toHaveBeenCalled()
    expect(mocks.uploadCopilotFile).toHaveBeenCalledOnce()
    expect(result.output.file).toMatchObject({ context: 'copilot' })
  })
})
