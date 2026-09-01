/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindchillOperationBody } from '@/lib/api/contracts/tools/windchill'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  createWindchillSession: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  downloadWindchillContent: vi.fn(),
  processFilesToUserFiles: vi.fn(),
  resolveWindchillContentUrl: vi.fn(),
  uploadCopilotFile: vi.fn(),
  uploadExecutionFile: vi.fn(),
  uploadWindchillContent: vi.fn(),
  windchillMutationRequest: vi.fn(),
}))

vi.mock('@/lib/internal/windchill/client', () => ({
  createWindchillSession: mocks.createWindchillSession,
  downloadWindchillContent: mocks.downloadWindchillContent,
  resolveWindchillContentUrl: mocks.resolveWindchillContentUrl,
  uploadWindchillContent: mocks.uploadWindchillContent,
  windchillDocumentUrl: (baseUrl: string, documentOid: string) =>
    `${baseUrl}/DocMgmt/Documents('${encodeURIComponent(documentOid)}')`,
  windchillMutationRequest: mocks.windchillMutationRequest,
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mocks.processFilesToUserFiles,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))

vi.mock('@/lib/uploads/contexts/copilot', () => ({
  uploadCopilotFile: mocks.uploadCopilotFile,
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecutionFile,
}))

import { WindchillOperationError } from '@/lib/internal/windchill/errors'
import { executeWindchillOperation } from '@/lib/internal/windchill/operations'

const BASE = {
  baseUrl: 'https://windchill.example.com/Windchill/servlet/odata/v6',
  username: 'windchill-user',
  password: 'not-a-real-password',
}
const DOCUMENT_OID = 'OR:wt.doc.WTDocument:1'
const SECOND_DOCUMENT_OID = 'OR:wt.doc.WTDocument:2'
const PRINCIPAL = createTestRuntimePrincipal()
const ACTORLESS_PRINCIPAL = createTestRuntimePrincipal({
  principal: {
    kind: 'system',
    serviceId: 'schedule',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
  },
  currentWorkflow: {
    workflowId: 'workflow-1',
    mode: 'deployment',
    deploymentVersionId: 'deployment-1',
  },
  compatibilityActorUserId: 'execution-actor',
})

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
    operation: 'windchill_update_common_properties',
    input: { documentOid: DOCUMENT_OID, commonProperties: { Name: 'Renamed' } },
    url: '/PTC.DocMgmt.UpdateCommonProperties',
    method: 'POST',
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
      securityLabelUpdates: [{ id: DOCUMENT_OID, labels: { EXPORT_CONTROL: 'EAR99' } }],
    },
    url: '/DocMgmt/EditDocumentsSecurityLabels',
    method: 'POST',
  },
] as const

describe('Windchill operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createWindchillSession.mockResolvedValue({
      nonceHeader: 'CSRF_NONCE',
      nonceValue: 'nonce',
      cookie: null,
    })
    mocks.windchillMutationRequest.mockResolvedValue({
      value: [{ ID: DOCUMENT_OID, Name: 'Specification' }],
    })
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.uploadWindchillContent.mockResolvedValue(['specification.pdf'])
    mocks.resolveWindchillContentUrl.mockResolvedValue(
      'https://windchill.example.com/WindchillGW/download?token=opaque'
    )
    mocks.downloadWindchillContent.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      contentType: 'application/pdf; charset=binary',
      contentDisposition: 'attachment; filename="specification.pdf"',
    })
    mocks.uploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      name: 'specification.pdf',
      url: '/api/files/serve?key=execution/specification.pdf',
      size: 3,
      type: 'application/pdf',
      key: 'execution/specification.pdf',
    })
  })

  it.each(MUTATION_CASES)(
    'executes $operation through one CSRF session with cancellation',
    async ({ operation, input, url, method }) => {
      const controller = new AbortController()
      const body = { ...BASE, operation, ...input } as WindchillOperationBody

      const result = await executeWindchillOperation(body, {
        principal: PRINCIPAL,
        requestId: 'request-1',
        signal: controller.signal,
      })

      expect(mocks.createWindchillSession).toHaveBeenCalledWith(body, controller.signal)
      expect(mocks.windchillMutationRequest).toHaveBeenCalledOnce()
      expect(mocks.windchillMutationRequest.mock.calls[0][0]).toMatchObject({
        method,
        signal: controller.signal,
      })
      expect(mocks.windchillMutationRequest.mock.calls[0][0].url).toContain(url)
      expect(result.operation).toBe(operation)
    }
  )

  it.each([
    {
      operation: 'windchill_check_out_documents',
      input: { documentOids: [DOCUMENT_OID], checkOutNote: 'Editing' },
      payload: { Documents: [{ ID: DOCUMENT_OID }], CheckOutNote: 'Editing' },
    },
    {
      operation: 'windchill_check_in_document',
      input: {
        documentOid: DOCUMENT_OID,
        checkInNote: 'Done',
        keepCheckedOut: false,
        checkOutNote: 'Continue editing',
      },
      payload: {
        CheckInNote: 'Done',
        KeepCheckedOut: false,
        CheckOutNote: 'Continue editing',
      },
    },
    {
      operation: 'windchill_set_lifecycle_state',
      input: { documentOid: DOCUMENT_OID, stateValue: 'RELEASED', stateDisplay: 'Released' },
      payload: { State: { Display: 'Released', Value: 'RELEASED' } },
    },
    {
      operation: 'windchill_update_document_security_labels',
      input: {
        securityLabelUpdates: [{ id: DOCUMENT_OID, labels: { EXPORT_CONTROL: 'EAR99' } }],
      },
      payload: { Documents: [{ EXPORT_CONTROL: 'EAR99', ID: DOCUMENT_OID }] },
    },
  ] as const)(
    'encodes the exact $operation action payload',
    async ({ operation, input, payload }) => {
      await executeWindchillOperation({ ...BASE, operation, ...input } as WindchillOperationBody, {
        principal: PRINCIPAL,
        requestId: 'request-1',
      })

      expect(mocks.windchillMutationRequest.mock.calls[0][0].body).toEqual(payload)
    }
  )

  it('authorizes, bounds, and downloads stored files before provider upload', async () => {
    const controller = new AbortController()
    const rawFile = {
      key: 'workspace/specification.pdf',
      name: 'specification.pdf',
      size: 3,
      type: 'application/pdf',
    }
    mocks.processFilesToUserFiles.mockReturnValue([rawFile])
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      contentType: 'application/pdf',
    })

    const result = await executeWindchillOperation(
      {
        ...BASE,
        operation: 'windchill_upload_primary_content',
        documentOid: DOCUMENT_OID,
        primaryFile: rawFile,
      },
      {
        principal: PRINCIPAL,
        workspaceId: 'workspace-1',
        requestId: 'request-1',
        signal: controller.signal,
      }
    )

    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      'workspace/specification.pdf',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.downloadServableFileFromStorage).toHaveBeenCalledWith(
      rawFile,
      'request-1',
      expect.anything(),
      { maxBytes: MAX_FILE_SIZE, signal: controller.signal }
    )
    expect(mocks.uploadWindchillContent).toHaveBeenCalledWith(
      expect.objectContaining({
        documentOid: DOCUMENT_OID,
        primaryContent: true,
        signal: controller.signal,
      })
    )
    expect(result).toEqual({
      operation: 'windchill_upload_primary_content',
      affectedIds: [DOCUMENT_OID],
      uploadedFileNames: ['specification.pdf'],
    })
  })

  it('uses the legacy execution actor for actorless file access', async () => {
    const rawFile = {
      key: 'workspace/specification.pdf',
      name: 'specification.pdf',
      size: 3,
      type: 'application/pdf',
    }
    mocks.processFilesToUserFiles.mockReturnValue([rawFile])
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      contentType: 'application/pdf',
    })

    await executeWindchillOperation(
      {
        ...BASE,
        operation: 'windchill_upload_primary_content',
        documentOid: DOCUMENT_OID,
        primaryFile: rawFile,
      },
      {
        principal: ACTORLESS_PRINCIPAL,
        requestId: 'request-1',
      }
    )

    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      rawFile.key,
      'execution-actor',
      'request-1',
      expect.anything()
    )
  })

  it('fails closed before storage or provider work when file access is denied', async () => {
    const rawFile = { key: 'other/file.pdf', name: 'file.pdf', size: 3, type: 'application/pdf' }
    mocks.processFilesToUserFiles.mockReturnValue([rawFile])
    mocks.assertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

    await expect(
      executeWindchillOperation(
        {
          ...BASE,
          operation: 'windchill_upload_primary_content',
          documentOid: DOCUMENT_OID,
          primaryFile: rawFile,
        },
        { principal: PRINCIPAL, requestId: 'request-1' }
      )
    ).rejects.toEqual(new WindchillOperationError('File not found', 404))
    expect(mocks.downloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.uploadWindchillContent).not.toHaveBeenCalled()
  })

  it('rejects declared aggregate upload size before authorization or download', async () => {
    const rawFile = { key: 'file.bin', name: 'file.bin', size: MAX_FILE_SIZE + 1 }
    mocks.processFilesToUserFiles.mockReturnValue([rawFile])

    await expect(
      executeWindchillOperation(
        {
          ...BASE,
          operation: 'windchill_upload_primary_content',
          documentOid: DOCUMENT_OID,
          primaryFile: rawFile,
        },
        { principal: PRINCIPAL, requestId: 'request-1' }
      )
    ).rejects.toEqual(
      new WindchillOperationError('Combined Windchill upload exceeds the maximum file size', 413)
    )
    expect(mocks.assertToolFileAccess).not.toHaveBeenCalled()
    expect(mocks.downloadServableFileFromStorage).not.toHaveBeenCalled()
  })

  it('stores provider downloads in the bound execution scope without returning inline bytes', async () => {
    const controller = new AbortController()

    const result = await executeWindchillOperation(
      {
        ...BASE,
        operation: 'windchill_download_primary_content',
        documentOid: DOCUMENT_OID,
      },
      {
        principal: PRINCIPAL,
        workspaceId: 'workspace-1',
        requestId: 'request-1',
        signal: controller.signal,
      }
    )

    expect(mocks.resolveWindchillContentUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        contentPath: expect.stringContaining('/PrimaryContent'),
        signal: controller.signal,
      })
    )
    expect(mocks.downloadWindchillContent).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: MAX_FILE_SIZE, signal: controller.signal })
    )
    expect(mocks.uploadExecutionFile).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      Buffer.from('pdf'),
      'specification.pdf',
      'application/pdf',
      'user-1'
    )
    expect(mocks.uploadCopilotFile).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      operation: 'windchill_download_primary_content',
      file: { key: 'execution/specification.pdf' },
      fileName: 'specification.pdf',
      mimeType: 'application/pdf',
    })
    expect(result).not.toHaveProperty('content')
  })

  it('attributes actorless provider downloads to the legacy execution actor', async () => {
    await executeWindchillOperation(
      {
        ...BASE,
        operation: 'windchill_download_primary_content',
        documentOid: DOCUMENT_OID,
      },
      {
        principal: ACTORLESS_PRINCIPAL,
        requestId: 'request-1',
      }
    )

    expect(mocks.uploadExecutionFile).toHaveBeenCalledWith(
      expect.anything(),
      Buffer.from('pdf'),
      'specification.pdf',
      'application/pdf',
      'execution-actor'
    )
  })
})
