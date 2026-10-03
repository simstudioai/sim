import { createExecutorPrincipal } from '@sim/testing/factories/principal.factory'
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
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

const mocks = vi.hoisted(() => ({
  createWindchillSession: vi.fn(),
  downloadWindchillContent: vi.fn(),
  resolveWindchillContentUrl: vi.fn(),
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

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

vi.mock('@/lib/uploads/contexts/copilot', () => uploadsCopilotMock)

vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)

import { WindchillOperationError } from '@/lib/internal/windchill/errors'
import { executeWindchillOperation } from '@/lib/internal/windchill/operations'

const { mockUploadCopilotFile } = uploadsCopilotMockFns

const { mockUploadExecutionFile } = uploadsExecutionMockFns

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockProcessFilesToUserFiles } = fileUtilsMockFns

const BASE = {
  baseUrl: 'https://windchill.example.com/Windchill/servlet/odata/v6',
  username: 'windchill-user',
  password: 'not-a-real-password',
}
const DOCUMENT_OID = 'OR:wt.doc.WTDocument:1'
const PRINCIPAL = createExecutorPrincipal({
  audience: 'sim:windchill',
  issuedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-01-01T01:00:00.000Z'),
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    executionId: 'execution-1',
  },
})

describe('Windchill operations', () => {
  beforeEach(() => {
    mocks.createWindchillSession.mockResolvedValue({
      nonceHeader: 'CSRF_NONCE',
      nonceValue: 'nonce',
      cookie: null,
    })
    mocks.windchillMutationRequest.mockResolvedValue({
      value: [{ ID: DOCUMENT_OID, Name: 'Specification' }],
    })
    mockAssertToolFileAccess.mockResolvedValue(null)
    mocks.uploadWindchillContent.mockResolvedValue(['specification.pdf'])
    mocks.resolveWindchillContentUrl.mockResolvedValue(
      'https://windchill.example.com/WindchillGW/download?token=opaque'
    )
    mocks.downloadWindchillContent.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      contentType: 'application/pdf; charset=binary',
      contentDisposition: 'attachment; filename="specification.pdf"',
    })
    mockUploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      name: 'specification.pdf',
      url: '/api/files/serve?key=execution/specification.pdf',
      size: 3,
      type: 'application/pdf',
      key: 'execution/specification.pdf',
    })
  })

  it('uses the legacy execution actor for actorless file access', async () => {
    const rawFile = {
      key: 'workspace/specification.pdf',
      name: 'specification.pdf',
      size: 3,
      type: 'application/pdf',
    }
    mockProcessFilesToUserFiles.mockReturnValue([rawFile])
    mockDownloadServableFileFromStorage.mockResolvedValue({
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
        principal: {
          ...PRINCIPAL,
          subjectUserId: undefined,
          delegationContext: {
            ...PRINCIPAL.delegationContext,
            currentWorkflow: {
              workflowId: 'workflow-1',
              mode: 'deployment',
              deploymentVersionId: 'deployment-1',
            },
            compatibilityActor: {
              kind: 'legacy_execution_user',
              userId: 'execution-actor',
            },
          },
        },
        requestId: 'request-1',
      }
    )

    expect(mockAssertToolFileAccess).toHaveBeenCalledWith(
      rawFile.key,
      'execution-actor',
      'request-1',
      expect.anything()
    )
  })

  it('fails closed before storage or provider work when file access is denied', async () => {
    const rawFile = { key: 'other/file.pdf', name: 'file.pdf', size: 3, type: 'application/pdf' }
    mockProcessFilesToUserFiles.mockReturnValue([rawFile])
    mockAssertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

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
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.uploadWindchillContent).not.toHaveBeenCalled()
  })

  it('rejects declared aggregate upload size before authorization or download', async () => {
    const rawFile = { key: 'file.bin', name: 'file.bin', size: MAX_FILE_SIZE + 1 }
    mockProcessFilesToUserFiles.mockReturnValue([rawFile])

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
    expect(mockAssertToolFileAccess).not.toHaveBeenCalled()
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
  })

  it('stores provider downloads in the bound execution scope without returning inline bytes', async () => {
    const controller = new AbortController()

    const result = await executeWindchillOperation(
      {
        ...BASE,
        operation: 'windchill_download_primary_content',
        documentOid: DOCUMENT_OID,
      },
      { principal: PRINCIPAL, requestId: 'request-1', signal: controller.signal }
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
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
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
    expect(mockUploadCopilotFile).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      operation: 'windchill_download_primary_content',
      file: { key: 'execution/specification.pdf' },
      fileName: 'specification.pdf',
      mimeType: 'application/pdf',
    })
    expect(result).not.toHaveProperty('content')
  })
})
