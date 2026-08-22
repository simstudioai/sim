/**
 * @vitest-environment node
 */
import { createMockRequest as createTestingRequest, resetEnvMock } from '@sim/testing'
import { NextResponse } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

const {
  MockInvalidBindingError,
  MockWindchillProviderError,
  mockAssertToolFileAccess,
  mockBindDelegation,
  mockCreateWindchillSession,
  mockDownloadServableFileFromStorage,
  mockDownloadWindchillContent,
  mockGetSession,
  mockResolveWindchillContentUrl,
  mockProcessFilesToUserFiles,
  mockUploadCopilotFile,
  mockUploadExecutionFile,
  mockUploadWindchillContent,
  mockWindchillMutationRequest,
} = vi.hoisted(() => {
  class MockInvalidBindingError extends Error {}
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
    MockInvalidBindingError,
    MockWindchillProviderError,
    mockAssertToolFileAccess: vi.fn(),
    mockBindDelegation: vi.fn(),
    mockCreateWindchillSession: vi.fn(),
    mockDownloadServableFileFromStorage: vi.fn(),
    mockDownloadWindchillContent: vi.fn(),
    mockGetSession: vi.fn(),
    mockResolveWindchillContentUrl: vi.fn(),
    mockProcessFilesToUserFiles: vi.fn(),
    mockUploadCopilotFile: vi.fn(),
    mockUploadExecutionFile: vi.fn(),
    mockUploadWindchillContent: vi.fn(),
    mockWindchillMutationRequest: vi.fn(),
  }
})

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/auth/internal-delegation', () => ({
  bindInternalExecutorDelegation: mockBindDelegation,
  InvalidInternalDelegationBindingError: MockInvalidBindingError,
}))
vi.unmock('@/lib/auth/internal')

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
  resolveWindchillContentUrl: mockResolveWindchillContentUrl,
  sanitizeWindchillError: (message: string) => message.replace(/https?:\/\/\S+/g, '[redacted URL]'),
  uploadWindchillContent: mockUploadWindchillContent,
  windchillDocumentUrl: (baseUrl: string, documentOid: string) =>
    `${baseUrl}/DocMgmt/Documents('${encodeURIComponent(documentOid)}')`,
  windchillMutationRequest: mockWindchillMutationRequest,
  WindchillProviderError: MockWindchillProviderError,
}))

import { generateInternalDelegationToken, generateInternalToken } from '@/lib/auth/internal'
import { POST } from '@/app/api/tools/windchill/route'

const BASE_BODY = {
  baseUrl: 'https://windchill.example.com/Windchill/servlet/odata/v6',
  username: 'windchill-user',
  password: 'not-a-real-password',
}

const DOCUMENT_OID = 'OR:wt.doc.WTDocument:1'
const SECOND_DOCUMENT_OID = 'OR:wt.doc.WTDocument:2'
let delegationToken = ''
let legacyInternalToken = ''

function createMockRequest(method: string, body: unknown, headers: Record<string, string> = {}) {
  return createTestingRequest(method, body, {
    authorization: `Bearer ${delegationToken}`,
    ...headers,
  })
}

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
    operation: 'windchill_update_common_properties',
    input: { documentOid: DOCUMENT_OID, commonProperties: { Name: 'Renamed' } },
    url: '/PTC.DocMgmt.UpdateCommonProperties',
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
    input: { documentOids: [DOCUMENT_OID] },
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

const MUTATION_PAYLOAD_CASES = [
  {
    operation: 'windchill_check_out_documents',
    input: { documentOids: [DOCUMENT_OID], checkOutNote: 'Editing' },
    body: { Documents: [{ ID: DOCUMENT_OID }], CheckOutNote: 'Editing' },
  },
  {
    operation: 'windchill_check_in_document',
    input: {
      documentOid: DOCUMENT_OID,
      checkInNote: 'Done',
      keepCheckedOut: false,
      checkOutNote: 'Continue editing',
    },
    body: {
      CheckInNote: 'Done',
      KeepCheckedOut: false,
      CheckOutNote: 'Continue editing',
    },
  },
  {
    operation: 'windchill_revise_document',
    input: { documentOid: DOCUMENT_OID, versionId: 'B' },
    body: { VersionId: 'B' },
  },
  {
    operation: 'windchill_update_common_properties',
    input: {
      documentOid: DOCUMENT_OID,
      commonProperties: { Name: 'Renamed', Number: 'DOC-001' },
    },
    body: { Updates: { Name: 'Renamed', Number: 'DOC-001' } },
  },
  {
    operation: 'windchill_revise_documents',
    input: { documentOids: [DOCUMENT_OID] },
    body: { Documents: [{ ID: DOCUMENT_OID }] },
  },
  {
    operation: 'windchill_set_lifecycle_state',
    input: { documentOid: DOCUMENT_OID, stateValue: 'RELEASED', stateDisplay: 'Released' },
    body: { State: { Display: 'Released', Value: 'RELEASED' } },
  },
  {
    operation: 'windchill_update_document_security_labels',
    input: {
      securityLabelUpdates: [{ id: DOCUMENT_OID, labels: { EXPORT_CONTROL: 'L1' } }],
    },
    body: { Documents: [{ EXPORT_CONTROL: 'L1', ID: DOCUMENT_OID }] },
  },
] as const

beforeAll(async () => {
  delegationToken = await generateInternalDelegationToken({
    subjectUserId: 'user-1',
    workflowId: '550e8400-e29b-41d4-a716-446655440001',
  })
  legacyInternalToken = await generateInternalToken()
})

afterAll(resetEnvMock)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(null)
  mockBindDelegation.mockImplementation(async (delegation, options) => ({
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: delegation.subjectUserId,
    workspaceId: '550e8400-e29b-41d4-a716-446655440000',
    delegationId: delegation.delegationId,
    audience: options.audience,
    issuedAt: delegation.issuedAt,
    expiresAt: delegation.expiresAt,
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: delegation.workflowId,
      executionId: delegation.executionId,
    },
  }))
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
  mockResolveWindchillContentUrl.mockImplementation(
    async ({ contentPath }: { contentPath: string }) =>
      `https://windchill.example.com/Windchill/servlet/WindchillGW/download?from=${encodeURIComponent(contentPath)}`
  )
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
    const response = await POST(createTestingRequest('POST', { operation: 'not-valid' }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ success: false, error: 'Unauthorized' })
    expect(mockCreateWindchillSession).not.toHaveBeenCalled()
  })

  it('binds executor identity and scope through the canonical delegation path', async () => {
    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_update_document',
        documentOid: DOCUMENT_OID,
        attributes: { Title: 'Updated' },
      })
    )

    expect(response.status).toBe(200)
    expect(mockBindDelegation).toHaveBeenCalledWith(expect.any(Object), {
      audience: 'sim:windchill',
      resourceScope: undefined,
    })
  })

  it('rejects browser sessions and legacy internal tokens', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })

    const sessionResponse = await POST(createTestingRequest('POST', BASE_BODY))
    const legacyResponse = await POST(
      createTestingRequest('POST', BASE_BODY, {
        authorization: `Bearer ${legacyInternalToken}`,
      })
    )

    expect(sessionResponse.status).toBe(401)
    expect(legacyResponse.status).toBe(401)
    expect(mockBindDelegation).not.toHaveBeenCalled()
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

  it.each(MUTATION_PAYLOAD_CASES)(
    'encodes the exact $operation action payload',
    async ({ operation, input, body }) => {
      const response = await POST(
        createMockRequest('POST', {
          ...BASE_BODY,
          operation,
          ...input,
        })
      )

      expect(response.status).toBe(200)
      expect(mockWindchillMutationRequest.mock.calls[0][0].body).toEqual(body)
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
    expect(mockDownloadServableFileFromStorage.mock.calls[0][3]).toEqual({
      maxBytes: MAX_FILE_SIZE,
    })
    expect(mockDownloadServableFileFromStorage.mock.calls[1][3]).toEqual({
      maxBytes: MAX_FILE_SIZE - 3,
    })
  })

  it('rejects attachment counts above the contract limit before reading storage', async () => {
    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_upload_attachments',
        documentOid: DOCUMENT_OID,
        attachmentFiles: Array.from({ length: 11 }, (_, index) => ({
          key: `workspace/workspace-1/${index}.txt`,
          name: `${index}.txt`,
          size: 1,
        })),
      })
    )

    expect(response.status).toBe(400)
    expect(mockAssertToolFileAccess).not.toHaveBeenCalled()
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
  })

  it('rejects declared aggregate upload size before reading storage', async () => {
    mockProcessFilesToUserFiles.mockReturnValueOnce([
      {
        key: 'workspace/workspace-1/oversized.bin',
        name: 'oversized.bin',
        size: MAX_FILE_SIZE + 1,
        type: 'application/octet-stream',
      },
    ])

    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_upload_primary_content',
        documentOid: DOCUMENT_OID,
        primaryFile: {
          key: 'workspace/workspace-1/oversized.bin',
          name: 'oversized.bin',
          size: MAX_FILE_SIZE + 1,
        },
      })
    )

    expect(response.status).toBe(413)
    expect(mockAssertToolFileAccess).not.toHaveBeenCalled()
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
  })

  it('stops an under-reported upload at the remaining aggregate byte budget', async () => {
    mockProcessFilesToUserFiles.mockReturnValueOnce([
      { key: 'workspace/workspace-1/one.txt', name: 'one.txt', size: 1, type: 'text/plain' },
      { key: 'workspace/workspace-1/two.txt', name: 'two.txt', size: 1, type: 'text/plain' },
      {
        key: 'workspace/workspace-1/three.txt',
        name: 'three.txt',
        size: 1,
        type: 'text/plain',
      },
    ])
    mockDownloadServableFileFromStorage
      .mockResolvedValueOnce({ buffer: Buffer.from('one'), contentType: 'text/plain' })
      .mockRejectedValueOnce(
        new PayloadSizeLimitError({
          label: 'Uploaded file',
          maxBytes: MAX_FILE_SIZE - 3,
          observedBytes: MAX_FILE_SIZE - 2,
        })
      )

    const response = await POST(
      createMockRequest('POST', {
        ...BASE_BODY,
        operation: 'windchill_upload_attachments',
        documentOid: DOCUMENT_OID,
        attachmentFiles: [
          { key: 'workspace/workspace-1/one.txt', name: 'one.txt', size: 1 },
          { key: 'workspace/workspace-1/two.txt', name: 'two.txt', size: 1 },
          { key: 'workspace/workspace-1/three.txt', name: 'three.txt', size: 1 },
        ],
      })
    )

    expect(response.status).toBe(413)
    expect(mockDownloadServableFileFromStorage).toHaveBeenCalledTimes(2)
    expect(mockDownloadServableFileFromStorage.mock.calls[1][3]).toEqual({
      maxBytes: MAX_FILE_SIZE - 3,
    })
    expect(mockUploadWindchillContent).not.toHaveBeenCalled()
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
    expect(mockResolveWindchillContentUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        contentPath: expect.stringContaining('/PrimaryContent'),
      })
    )
    expect(mockResolveWindchillContentUrl.mock.calls[0][0].contentPath).not.toContain('$value')
    expect(mockDownloadWindchillContent).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('/WindchillGW/download'),
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
    expect(mockResolveWindchillContentUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        contentPath: expect.stringContaining("/Attachments('OR%3Awt.content.ApplicationData%3A2')"),
      })
    )
    expect(mockDownloadWindchillContent).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('/WindchillGW/download'),
      })
    )
  })

  it('uses execution storage derived from the bound delegation principal', async () => {
    mockBindDelegation.mockResolvedValueOnce({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: '550e8400-e29b-41d4-a716-446655440000',
      delegationId: 'delegation-1',
      audience: 'sim:windchill',
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: '550e8400-e29b-41d4-a716-446655440001',
        executionId: 'execution-1',
      },
    })
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
        workspaceId: 'forged-workspace',
        workflowId: 'forged-workflow',
        executionId: 'forged-execution',
      })
    )

    expect(response.status).toBe(200)
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      {
        workspaceId: '550e8400-e29b-41d4-a716-446655440000',
        workflowId: '550e8400-e29b-41d4-a716-446655440001',
        executionId: 'execution-1',
      },
      Buffer.from('pdf'),
      'specification.pdf',
      'application/pdf',
      'user-1'
    )
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
