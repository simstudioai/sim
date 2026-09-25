import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  json: vi.fn(),
  document: vi.fn(),
  assertToolFileAccess: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  processFilesToUserFiles: vi.fn(),
  fileParse: vi.fn(),
  uploadExecutionFile: vi.fn(),
  uploadCopilotFile: vi.fn(),
}))

vi.mock('@/lib/internal/docusign/client', () => ({
  MAX_DOCUSIGN_DOCUMENT_BYTES: 25 * 1024 * 1024,
  DocuSignClient: class {
    static create = mocks.create
  },
}))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mocks.processFilesToUserFiles,
}))
vi.mock('@/lib/uploads/utils/file-schemas', () => ({
  FileInputSchema: { parse: mocks.fileParse },
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecutionFile,
}))
vi.mock('@/lib/uploads/contexts/copilot', () => ({
  uploadCopilotFile: mocks.uploadCopilotFile,
}))

import { DocuSignOperationError } from '@/lib/internal/docusign/errors'
import {
  executeDocuSignDownloadDocument,
  executeDocuSignSendEnvelope,
} from '@/lib/internal/docusign/operations'

const CONTEXT = {
  requestId: 'request-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
}

describe('DocuSign operations', () => {
  beforeEach(() => {
    mocks.create.mockResolvedValue({ json: mocks.json, document: mocks.document })
    mocks.json.mockResolvedValue({ envelopeId: 'envelope-1', status: 'sent' })
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.fileParse.mockReturnValue({ id: 'file-1' })
    mocks.processFilesToUserFiles.mockReturnValue([
      {
        id: 'file-1',
        key: 'workspace/file-1',
        name: 'contract.pdf',
        size: 8,
        type: 'application/pdf',
      },
    ])
    mocks.downloadServableFileFromStorage.mockResolvedValue({ buffer: Buffer.from('contract') })
    mocks.document.mockResolvedValue({
      buffer: Buffer.from('signed'),
      contentType: 'application/pdf',
      fileName: 'signed.pdf',
    })
    mocks.uploadExecutionFile.mockResolvedValue({ id: 'output-1', name: 'signed.pdf' })
  })

  it('does not download or contact DocuSign when file access is denied', async () => {
    mocks.assertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

    await expect(
      executeDocuSignSendEnvelope(
        {
          accessToken: 'access-token',
          emailSubject: 'Sign',
          signerEmail: 'a@example.com',
          signerName: 'A',
          file: { id: 'file-1' },
        },
        CONTEXT
      )
    ).rejects.toEqual(new DocuSignOperationError('File not found', 404))
    expect(mocks.downloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('stores downloads in the trusted execution scope', async () => {
    const result = await executeDocuSignDownloadDocument(
      { accessToken: 'access-token', envelopeId: 'envelope-1' },
      CONTEXT
    )

    expect(mocks.uploadExecutionFile).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      Buffer.from('signed'),
      'signed.pdf',
      'application/pdf',
      'user-1'
    )
    expect(result).toMatchObject({
      file: { id: 'output-1' },
      base64Content: Buffer.from('signed').toString('base64'),
    })
    expect(mocks.uploadCopilotFile).not.toHaveBeenCalled()
  })
})
