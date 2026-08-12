/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockWindchillProviderError,
  mockAssertToolFileAccess,
  mockCreateWindchillSession,
  mockDownloadServableFileFromStorage,
  mockDownloadWindchillContent,
  mockProcessFilesToUserFiles,
  mockUploadCopilotFile,
  mockUploadExecutionFile,
  mockUploadWindchillContent,
  mockWindchillMutationRequest,
} = vi.hoisted(() => {
  class MockWindchillProviderError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
      this.name = 'WindchillProviderError'
    }
  }

  return {
    MockWindchillProviderError,
    mockAssertToolFileAccess: vi.fn(),
    mockCreateWindchillSession: vi.fn(),
    mockDownloadServableFileFromStorage: vi.fn(),
    mockDownloadWindchillContent: vi.fn(),
    mockProcessFilesToUserFiles: vi.fn(),
    mockUploadCopilotFile: vi.fn(),
    mockUploadExecutionFile: vi.fn(),
    mockUploadWindchillContent: vi.fn(),
    mockWindchillMutationRequest: vi.fn(),
  }
})

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mockAssertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mockProcessFilesToUserFiles,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mockDownloadServableFileFromStorage,
}))
vi.mock('@/lib/uploads/utils/servable-file-response', () => ({
  docNotReadyResponse: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/uploads/contexts/copilot', () => ({
  uploadCopilotFile: mockUploadCopilotFile,
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mockUploadExecutionFile,
}))
vi.mock('@/tools/windchill/utils.server', () => ({
  createWindchillSession: mockCreateWindchillSession,
  downloadWindchillContent: mockDownloadWindchillContent,
  sanitizeWindchillError: (message: string) => message.replace(/https?:\/\/\S+/g, '[redacted URL]'),
  uploadWindchillContent: mockUploadWindchillContent,
  windchillDocumentUrl: (baseUrl: string, documentOid: string) =>
    `${baseUrl}/DocMgmt/Documents('${encodeURIComponent(documentOid)}')`,
  windchillMutationRequest: mockWindchillMutationRequest,
  WindchillProviderError: MockWindchillProviderError,
}))

import { POST } from '@/app/api/tools/windchill/route'

const BASE_BODY = {
  baseUrl: 'https://windchill.example.com/Windchill/servlet/odata/v6',
  username: 'windchill-user',
  password: 'not-a-real-password',
}

const DOCUMENT_OID = 'OR:wt.doc.WTDocument:1'
const SECOND_DOCUMENT_OID = 'OR:wt.doc.WTDocument:2'

const MUTATION_CASES = [
  {
    operation: 'windchill_create_document',
    input: { name: 'Specification', containerOid: 'OR:wt.pdmlink.PDMLinkProduct:1' },
    url: '/DocMgmt/Documents',
    method: 'POST',
  },
  {
    operation: 'windchill_create_documents',
    input: {
      documents: [{ name: 'Specification', containerOid: 'OR:wt.pdmlink.PDMLinkProduct:1' }],
    },
    url: '/DocMgmt/CreateDocuments',
    method: 'POST',
  },
  {
    operation: 'windchill_update_document',
    input: { documentOid: DOCUMENT_OID, attributes: { Title: 'Updated' } },
    url: '/DocMgmt/Documents(',
    method: 'PATCH',
  },
  {
    operation: 'windchill_update_documents',
    input: { documents: [{ id: DOCUMENT_OID, attributes: { Title: 'Updated' } }] },
    url: '/DocMgmt/UpdateDocuments',
    method: 'POST',
  },
  {
    operation: 'windchill_delete_document',
    input: { documentOid: DOCUMENT_OID },
    url: '/DocMgmt/Documents(',
    method: 'DELETE',
  },
  {
    operation: 'windchill_delete_documents',
    input: { documentOids: [DOCUMENT_OID, SECOND_DOCUMENT_OID] },
    url: '/DocMgmt/DeleteDocuments',
    method: 'POST',
  },
  {
    operation: 'windchill_check_out_document',
    input: { documentOid: DOCUMENT_OID, checkOutNote: 'Editing' },
    url: '/PTC.DocMgmt.CheckOut',
    method: 'POST',
  },
  {
    operation: 'windchill_check_out_documents',
    input: { documentOids: [DOCUMENT_OID], checkOutNote: 'Editing' },
    url: '/DocMgmt/CheckOutDocuments',
    method: 'POST',
  },
  {
    operation: 'windchill_check_in_document',
    input: { documentOid: DOCUMENT_OID, checkInNote: 'Done', keepCheckedOut: false },
    url: '/PTC.DocMgmt.CheckIn',
    method: 'POST',
  },
  {
    operation: 'windchill_check_in_documents',
    input: { documentOids: [DOCUMENT_OID], checkInNote: 'Done' },
    url: '/DocMgmt/CheckInDocuments',
    method: 'POST',
  },
  {
    operation: 'windchill_undo_check_out_document',
    input: { documentOid: DOCUMENT_OID },
    url: '/PTC.DocMgmt.UndoCheckOut',
    method: 'POST',
  },
  {
    operation: 'windchill_undo_check_out_documents',
    input: { documentOids: [DOCUMENT_OID] },
    url: '/DocMgmt/UndoCheckOutDocuments',
    method: 'POST',
  },
  {
    operation: 'windchill_revise_document',
    input: { documentOid: DOCUMENT_OID, versionId: 'B' },
    url: '/PTC.DocMgmt.Revise',
    method: 'POST',
  },
  {
    operation: 'windchill_revise_documents',
    input: { documentOids: [DOCUMENT_OID], versionId: 'B' },
    url: '/DocMgmt/ReviseDocuments',
    method: 'POST',
  },
  {
    operation: 'windchill_set_lifecycle_state',
    input: { documentOid: DOCUMENT_OID, stateValue: 'RELEASED', stateDisplay: 'Released' },
    url: '/PTC.DocMgmt.SetState',
    method: 'POST',
  },
  {
    operation: 'windchill_update_document_security_labels',
    input: {
      securityLabelUpdates: [{ id: DOCUMENT_OID, labels: { EXPORT_CONTROL: 'L1' } }],
    },
    url: '/DocMgmt/EditDocumentsSecurityLabels',
    method: 'POST',
  },
] as const

beforeEach(() => {
  vi.clearAllMocks()
  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  mockCreateWindchillSession.mockResolvedValue({
    nonceHeader: 'CSRF_NONCE',
    nonceValue: 'nonce-value',
    cookie: 'JSESSIONID=session-value',
  })
  mockWindchillMutationRequest.mockResolvedValue({ value: [{ ID: DOCUMENT_OID }] })
  mockAssertToolFileAccess.mockResolvedValue(null)
  mockProcessFilesToUserFiles.mockReturnValue([
    {
      key: 'workspace/workspace-1/specification.pdf',
      name: 'specification.pdf',
      size: 3,
      type: 'application/pdf',
    },
  ])
  mockDownloadServableFileFromStorage.mockResolvedValue({
    buffer: Buffer.from('pdf'),
    contentType: 'application/pdf',
  })
  mockUploadWindchillContent.mockResolvedValue(['specification.pdf'])
  mockDownloadWindchillContent.mockResolvedValue({
    buffer: Buffer.from('pdf'),
    contentType: 'application/pdf',
    contentDisposition: 'attachment; filename="specification.pdf"',
  })
  mockUploadCopilotFile.mockResolvedValue({
    id: 'file-1',
    name: 'specification.pdf',
    url: '/api/files/serve?key=copilot/specification.pdf',
    size: 3,
    type: 'application/pdf',
    key: 'copilot/specification.pdf',
  })
})

describe('POST /api/tools/windchill', () => {
  it('authenticates before parsing the request body', async () => {
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const response = await POST(createMockRequest('POST', { operation: 'not-valid' }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ success: false, error: 'Unauthorized' })
    expect(mockCreateWindchillSession).not.toHaveBeenCalled()
  })

  it('rejects malformed operation inputs at the shared contract boundary', async () => {
    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_update_document',
        documentOid: DOCUMENT_OID,
        attributes: {},
      })
    )

    expect(response.status).toBe(400)
    expect(mockCreateWindchillSession).not.toHaveBeenCalled()
  })

  it('rejects an invalid service root before reading a protected upload', async () => {
    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        baseUrl: `${BASE_BODY.baseUrl}?token=secret`,
        operation: 'windchill_upload_primary_content',
        documentOid: DOCUMENT_OID,
        primaryFile: {
          key: 'workspace/workspace-1/specification.pdf',
          name: 'specification.pdf',
          size: 3,
          type: 'application/pdf',
        },
      })
    )

    expect(response.status).toBe(400)
    expect(mockAssertToolFileAccess).not.toHaveBeenCalled()
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
  })

  it.each(MUTATION_CASES)(
    'dispatches $operation through one CSRF-protected transaction',
    async ({ operation, input, url, method }) => {
      const response = await POST(createMockRequest('POST', { ...BASE_BODY, operation, ...input }))

      expect(response.status).toBe(200)
      expect((await response.json()).success).toBe(true)
      expect(mockCreateWindchillSession).toHaveBeenCalledTimes(1)
      expect(mockWindchillMutationRequest).toHaveBeenCalledTimes(1)
      expect(mockWindchillMutationRequest.mock.calls[0][0].url).toContain(url)
      expect(mockWindchillMutationRequest.mock.calls[0][0].method).toBe(method)
    }
  )

  it('maps create bindings and custom attributes without allowing them to replace bindings', async () => {
    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_create_document',
        name: 'Specification',
        containerOid: 'OR:wt.pdmlink.PDMLinkProduct:1',
        folderOid: 'OR:wt.folder.SubFolder:2',
        attributes: { CustomString: 'value' },
      })
    )

    expect(response.status).toBe(200)
    expect((await response.json()).output.affectedIds).toEqual([DOCUMENT_OID])
    expect(mockWindchillMutationRequest.mock.calls[0][0].body).toEqual({
      CustomString: 'value',
      Name: 'Specification',
      'Context@odata.bind': "Containers('OR%3Awt.pdmlink.PDMLinkProduct%3A1')",
      'Folder@odata.bind': "Folders('OR%3Awt.folder.SubFolder%3A2')",
    })
  })

  it('returns operation-specific single, bulk, and delete mutation shapes', async () => {
    const singleResponse = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_update_document',
        documentOid: DOCUMENT_OID,
        attributes: { Title: 'Updated' },
      })
    )
    const singleOutput = (await singleResponse.json()).output
    expect(singleOutput.document).toMatchObject({ id: DOCUMENT_OID })
    expect(singleOutput).not.toHaveProperty('documents')

    const bulkResponse = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_update_documents',
        documents: [{ id: DOCUMENT_OID, attributes: { Title: 'Updated' } }],
      })
    )
    const bulkOutput = (await bulkResponse.json()).output
    expect(bulkOutput.documents).toEqual([expect.objectContaining({ id: DOCUMENT_OID })])
    expect(bulkOutput).not.toHaveProperty('document')

    const deleteResponse = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_delete_document',
        documentOid: DOCUMENT_OID,
      })
    )
    const deleteOutput = (await deleteResponse.json()).output
    expect(deleteOutput.affectedIds).toEqual([DOCUMENT_OID])
    expect(deleteOutput).not.toHaveProperty('document')
    expect(deleteOutput).not.toHaveProperty('documents')
  })

  it('authorizes and reads a UserFile before starting the upload transaction', async () => {
    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_upload_primary_content',
        documentOid: DOCUMENT_OID,
        primaryFile: {
          key: 'workspace/workspace-1/specification.pdf',
          name: 'specification.pdf',
          size: 3,
          type: 'application/pdf',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(mockAssertToolFileAccess).toHaveBeenCalledWith(
      'workspace/workspace-1/specification.pdf',
      'user-1',
      expect.any(String),
      expect.anything()
    )
    expect(mockDownloadServableFileFromStorage).toHaveBeenCalledTimes(1)
    expect(mockUploadWindchillContent).toHaveBeenCalledWith(
      expect.objectContaining({
        documentOid: DOCUMENT_OID,
        primaryContent: true,
        files: [
          expect.objectContaining({
            name: 'specification.pdf',
            mimeType: 'application/pdf',
            size: 3,
          }),
        ],
      })
    )
  })

  it('uploads multiple authorized files as attachments', async () => {
    mockProcessFilesToUserFiles.mockReturnValueOnce([
      {
        key: 'workspace/workspace-1/one.txt',
        name: 'one.txt',
        size: 3,
        type: 'text/plain',
      },
      {
        key: 'workspace/workspace-1/two.txt',
        name: 'two.txt',
        size: 3,
        type: 'text/plain',
      },
    ])
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('txt'),
      contentType: 'text/plain',
    })
    mockUploadWindchillContent.mockResolvedValueOnce(['one.txt', 'two.txt'])

    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_upload_attachments',
        documentOid: DOCUMENT_OID,
        attachmentFiles: [
          { key: 'workspace/workspace-1/one.txt', name: 'one.txt', size: 3 },
          { key: 'workspace/workspace-1/two.txt', name: 'two.txt', size: 3 },
        ],
      })
    )

    expect(response.status).toBe(200)
    expect(mockAssertToolFileAccess).toHaveBeenCalledTimes(2)
    expect(mockDownloadServableFileFromStorage).toHaveBeenCalledTimes(2)
    expect(mockUploadWindchillContent).toHaveBeenCalledWith(
      expect.objectContaining({ primaryContent: false })
    )
  })

  it('stops before storage or Windchill when file ownership is denied', async () => {
    mockAssertToolFileAccess.mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'File not found' }, { status: 404 })
    )

    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_upload_primary_content',
        documentOid: DOCUMENT_OID,
        primaryFile: {
          key: 'workspace/other/specification.pdf',
          name: 'specification.pdf',
          size: 3,
          type: 'application/pdf',
        },
      })
    )

    expect(response.status).toBe(404)
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mockUploadWindchillContent).not.toHaveBeenCalled()
  })

  it('stores downloads as a UserFile instead of returning inline bytes', async () => {
    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_download_primary_content',
        documentOid: DOCUMENT_OID,
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockDownloadWindchillContent).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('/PrimaryContent/$value'),
      })
    )
    expect(mockUploadCopilotFile).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: Buffer.from('pdf'),
        fileName: 'specification.pdf',
        contentType: 'application/pdf',
        userId: 'user-1',
      })
    )
    expect(data.output.file).toMatchObject({ key: 'copilot/specification.pdf' })
    expect(data.output.content).toBeUndefined()
  })

  it('downloads an attachment through its document-scoped content path', async () => {
    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_download_attachment',
        documentOid: DOCUMENT_OID,
        attachmentOid: 'OR:wt.content.ApplicationData:2',
      })
    )

    expect(response.status).toBe(200)
    expect(mockDownloadWindchillContent).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining("/Attachments('OR%3Awt.content.ApplicationData%3A2')/$value"),
      })
    )
  })

  it('uses execution storage when a complete execution context is provided', async () => {
    mockUploadExecutionFile.mockResolvedValueOnce({
      id: 'file-2',
      name: 'specification.pdf',
      url: '/api/files/serve?key=execution/specification.pdf',
      size: 3,
      type: 'application/pdf',
      key: 'execution/specification.pdf',
    })

    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_download_primary_content',
        documentOid: DOCUMENT_OID,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000',
        workflowId: '550e8400-e29b-41d4-a716-446655440001',
        executionId: 'execution-1',
      })
    )

    expect(response.status).toBe(200)
    expect(mockUploadExecutionFile).toHaveBeenCalledTimes(1)
    expect(mockUploadCopilotFile).not.toHaveBeenCalled()
  })

  it('preserves sanitized provider status codes', async () => {
    mockWindchillMutationRequest.mockRejectedValueOnce(
      new MockWindchillProviderError('Windchill rejected the transition', 409)
    )

    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_set_lifecycle_state',
        documentOid: DOCUMENT_OID,
        stateValue: 'RELEASED',
        stateDisplay: 'Released',
      })
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Windchill rejected the transition',
    })
  })
})
