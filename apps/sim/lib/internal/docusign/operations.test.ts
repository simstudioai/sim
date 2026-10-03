import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { uploadsCopilotMock, uploadsCopilotMockFns } from '@sim/testing/mocks/uploads-copilot.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  json: vi.fn(),
  document: vi.fn(),
  fileParse: vi.fn(),
}))

vi.mock('@/lib/internal/docusign/client', () => ({
  MAX_DOCUSIGN_DOCUMENT_BYTES: 25 * 1024 * 1024,
  DocuSignClient: class {
    static create = mocks.create
  },
}))
vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)
vi.mock('@/lib/uploads/utils/file-schemas', () => ({
  FileInputSchema: { parse: mocks.fileParse },
}))
vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)
vi.mock('@/lib/uploads/contexts/copilot', () => uploadsCopilotMock)

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockProcessFilesToUserFiles } = fileUtilsMockFns

import { DocuSignOperationError } from '@/lib/internal/docusign/errors'
import {
  executeDocuSignDownloadDocument,
  executeDocuSignSendEnvelope,
} from '@/lib/internal/docusign/operations'

const { mockUploadCopilotFile } = uploadsCopilotMockFns

const { mockUploadExecutionFile } = uploadsExecutionMockFns

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
    mockAssertToolFileAccess.mockResolvedValue(null)
    mocks.fileParse.mockReturnValue({ id: 'file-1' })
    mockProcessFilesToUserFiles.mockReturnValue([
      {
        id: 'file-1',
        key: 'workspace/file-1',
        name: 'contract.pdf',
        size: 8,
        type: 'application/pdf',
      },
    ])
    mockDownloadServableFileFromStorage.mockResolvedValue({ buffer: Buffer.from('contract') })
    mocks.document.mockResolvedValue({
      buffer: Buffer.from('signed'),
      contentType: 'application/pdf',
      fileName: 'signed.pdf',
    })
    mockUploadExecutionFile.mockResolvedValue({ id: 'output-1', name: 'signed.pdf' })
  })

  it('does not download or contact DocuSign when file access is denied', async () => {
    mockAssertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

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
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('stores downloads in the trusted execution scope', async () => {
    const result = await executeDocuSignDownloadDocument(
      { accessToken: 'access-token', envelopeId: 'envelope-1' },
      CONTEXT
    )

    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
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
    expect(mockUploadCopilotFile).not.toHaveBeenCalled()
  })
})
