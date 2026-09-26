import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import { uploadSessionMock, uploadSessionMockFns } from '@sim/testing/mocks/upload-session.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  finalizePurpose: vi.fn(),
  reauthorizeWorkspacePurpose: vi.fn(),
  authorizeCreate: vi.fn(),
  attribution: vi.fn(),
  authorizeOrganizationAttachment: vi.fn(),
  authorizeOrganizationLogo: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/organization-assistant/application', () => ({
  authorizeOrganizationAttachmentControl: hoisted.authorizeOrganizationAttachment,
  createOrganizationAssistantAttachment: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/organization-logo/application', () => ({
  authorizeOrganizationLogoControl: hoisted.authorizeOrganizationLogo,
  createOrganizationLogoUpload: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)

vi.mock('@/lib/uploads/upload-session/service', () => uploadSessionMock)

vi.mock('@/app/api/files/uploads/finalizers', () => ({
  finalizeUploadPurpose: hoisted.finalizePurpose,
  finalizeWorkspaceFileUpload: vi.fn(),
  loadCompletedUploadPurpose: vi.fn(),
  loadCompletedWorkspaceFileUpload: vi.fn(),
}))

vi.mock('@/app/api/files/uploads/purposes', () => ({
  createPurposeUploadSession: vi.fn(),
  reauthorizeUploadPurpose: vi.fn(),
  reauthorizeWorkspaceUploadPurpose: hoisted.reauthorizeWorkspacePurpose,
  resolveUploadAttributionUserId: hoisted.attribution,
}))

vi.mock('@/lib/workspace-files/application/workspace-operation-context', () => ({
  authorizeWorkspaceFileOperation: hoisted.authorizeCreate,
}))
vi.mock('@/lib/folders/queries', () => folderQueriesMock)

import {
  abortInternalUploadSession,
  completeInternalUploadSession,
  completeWorkspaceFileUploadOperation,
  createWorkspaceFileUploadOperation,
  issueInternalUploadPartUrls,
  readWorkspaceUploadSession,
} from '@/lib/uploads/upload-session/application'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'

folderQueriesMockFns.mockLoadActiveFolderPathIndex.mockImplementation(async () => new Map())
folderQueriesMockFns.mockResolveFolderPathFromIndex.mockReturnValue(null)

const mocks = {
  ...hoisted,
  assertAuthBinding: uploadSessionMockFns.mockAssertUploadSessionAuthBinding,
  completeSession: uploadSessionMockFns.mockCompleteUploadSession,
  getOwnedSession: uploadSessionMockFns.mockGetOwnedUploadSession,
  getPrincipalSession: uploadSessionMockFns.mockGetPrincipalUploadSession,
  createSession: uploadSessionMockFns.mockCreateUploadSession,
  getWorkspaceFile: workspaceUploadsMockFns.mockGetWorkspaceFile,
}

const principal = createSessionPrincipal()

describe('upload session application', () => {
  beforeEach(() => {
    mocks.authorizeOrganizationAttachment.mockResolvedValue(undefined)
    mocks.authorizeOrganizationLogo.mockResolvedValue(undefined)
    const session = workspaceUploadSession()
    mocks.getOwnedSession.mockResolvedValue(session)
    mocks.authorizeCreate.mockResolvedValue(undefined)
    mocks.attribution.mockResolvedValue('user-1')
    mocks.createSession.mockResolvedValue(session)
    mocks.finalizePurpose.mockResolvedValue({
      value: { id: 'file-1' },
      completedFileId: 'file-1',
    })
    mocks.getPrincipalSession.mockResolvedValue(session)
    mocks.completeSession.mockImplementation(async ({ session: claimed, finalize }) => {
      const finalized = await finalize(claimed)
      return {
        session: { ...claimed, status: 'completed', completedFileId: finalized.completedFileId },
        value: finalized.value,
        alreadyCompleted: false,
      }
    })
  })

  it('authorizes a private completion before forwarding streamed source evidence', async () => {
    const secretProvenance = { status: 'exact', entries: [] } as const
    mocks.completeSession.mockResolvedValue({ value: { id: 'file-1' } })
    await completeWorkspaceFileUploadOperation.execute({
      principal,
      input: { uploadId: 'upload-1', uploadToken: 'upload-secret', workspaceId: 'workspace-1' },
      request: new NextRequest('http://localhost/api/files/uploads/upload-1/complete'),
      secretProvenance,
    })
    expect(mocks.reauthorizeWorkspacePurpose).toHaveBeenCalledBefore(mocks.completeSession)
    expect(mocks.completeSession).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance })
    )
  })

  it('does not seal private evidence when upload completion access is revoked', async () => {
    mocks.reauthorizeWorkspacePurpose.mockRejectedValueOnce(new Error('Access revoked'))
    await expect(
      completeWorkspaceFileUploadOperation.execute({
        principal,
        input: { uploadId: 'upload-1', uploadToken: 'upload-secret', workspaceId: 'workspace-1' },
        request: new NextRequest('http://localhost/api/files/uploads/upload-1/complete'),
        secretProvenance: { status: 'exact', entries: [] },
      })
    ).rejects.toThrow('Access revoked')
    expect(mocks.completeSession).not.toHaveBeenCalled()
  })

  it.each(['complete', 'abort', 'parts'] as const)(
    'rechecks organization membership before the %s control leg',
    async (control) => {
      const session = {
        ...workspaceUploadSession(),
        purpose: 'mothership_attachment' as const,
        workspaceId: null,
      }
      mocks.getOwnedSession.mockResolvedValue(session)
      const request = new NextRequest('http://localhost/api/files/uploads/upload-1/complete', {
        headers: { host: 'localhost' },
      })
      const input = { uploadId: 'upload-1', uploadToken: 'upload-token', partNumbers: [1] }
      if (control === 'complete') await completeInternalUploadSession(principal, input, request)
      else if (control === 'abort') await abortInternalUploadSession(principal, input)
      else await issueInternalUploadPartUrls(principal, input, request)
      expect(mocks.assertAuthBinding).toHaveBeenCalledWith(session, principal)
      expect(mocks.authorizeOrganizationAttachment).toHaveBeenCalledWith(principal, session)
      expect(mocks.reauthorizeWorkspacePurpose).not.toHaveBeenCalled()
    }
  )

  it('does not finalize when organization access is revoked after the session is claimed', async () => {
    const session = {
      ...workspaceUploadSession(),
      purpose: 'mothership_attachment' as const,
      workspaceId: null,
    }
    mocks.getOwnedSession.mockResolvedValue(session)
    mocks.authorizeOrganizationAttachment
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Organization not found'))
    await expect(
      completeInternalUploadSession(
        principal,
        { uploadId: 'upload-1', uploadToken: 'upload-token' },
        new NextRequest('http://localhost/api/files/uploads/upload-1/complete')
      )
    ).rejects.toThrow('Organization not found')
    expect(mocks.finalizePurpose).not.toHaveBeenCalled()
  })

  it('carries trusted classification outside the parsed create input after authorization', async () => {
    const secretProvenance = { status: 'unknown' as const }
    await createWorkspaceFileUploadOperation.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        name: 'result.txt',
        contentType: 'text/plain',
        size: 10,
        folderPath: '/',
      },
      request: new NextRequest('http://localhost/api/files/uploads', {
        headers: { origin: 'http://localhost' },
      }),
      secretProvenance,
    })
    expect(mocks.authorizeCreate).toHaveBeenCalledBefore(mocks.createSession)
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        workspaceId: 'workspace-1',
        secretProvenance,
        metadata: { folderId: null },
      })
    )
  })

  it('does not start a classified upload after the create operation denies access', async () => {
    mocks.authorizeCreate.mockRejectedValueOnce(new Error('Access revoked'))
    await expect(
      createWorkspaceFileUploadOperation.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          name: 'result.txt',
          contentType: 'text/plain',
          size: 10,
          folderPath: '/',
        },
        request: new NextRequest('http://localhost/api/files/uploads', {
          headers: { origin: 'http://localhost' },
        }),
        secretProvenance: { status: 'unknown' },
      })
    ).rejects.toThrow('Access revoked')
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  /**
   * The read is a control leg, so it re-authorizes the caller's present
   * workspace permission rather than trusting the session lookup alone.
   */
  it('re-authorizes a session read against the read operation', async () => {
    const { session } = await readWorkspaceUploadSession(principal, {
      uploadId: 'upload-1',
      workspaceId: 'workspace-1',
      uploadToken: 'upload-token',
    })

    expect(session.id).toBe('upload-1')
    expect(mocks.reauthorizeWorkspacePurpose).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ id: 'upload-1' }),
      expect.objectContaining({ id: 'files.upload.read', minimumRole: 'read' })
    )
  })

  it('does not look for a file before finalization completes', async () => {
    const { file } = await readWorkspaceUploadSession(principal, {
      uploadId: 'upload-1',
      workspaceId: 'workspace-1',
      uploadToken: 'upload-token',
    })

    expect(file).toBeNull()
    expect(mocks.getWorkspaceFile).not.toHaveBeenCalled()
  })

  /**
   * `getWorkspaceFile` logs and returns null on a read failure unless told
   * otherwise, which would report a finalized upload as fileless to the one
   * caller polling to learn what it created — and they would stop, believing
   * there was nothing. A failed read is not the same answer as no file.
   */
  it('surfaces a failed file read instead of reporting the upload fileless', async () => {
    const completed = {
      ...workspaceUploadSession(),
      status: 'completed' as const,
      completedFileId: 'file-1',
    }
    mocks.getOwnedSession.mockResolvedValue(completed)
    mocks.getPrincipalSession.mockResolvedValue(completed)
    mocks.getWorkspaceFile.mockRejectedValue(new Error('connection terminated'))

    await expect(
      readWorkspaceUploadSession(principal, {
        uploadId: 'upload-1',
        workspaceId: 'workspace-1',
        uploadToken: 'upload-token',
      })
    ).rejects.toThrow('connection terminated')
  })
})

function workspaceUploadSession(): UploadSessionRecord {
  const now = new Date('2026-08-08T00:00:00.000Z')
  return {
    id: 'upload-1',
    workspaceId: 'workspace-1',
    userId: principal.userId,
    knowledgeBaseId: null,
    workflowId: null,
    executionId: null,
    purpose: 'workspace_file',
    method: 'put',
    storageContext: 'workspace',
    storageKey: 'workspace/workspace-1/file.txt',
    finalKey: 'workspace/workspace-1/file.txt',
    storageProvider: 's3',
    providerUploadId: null,
    providerObjectVersion: 'version-1',
    fileName: 'file.txt',
    contentType: 'text/plain',
    fileSize: 4,
    partSize: null,
    partCount: null,
    status: 'finalizing',
    metadata: {},
    uploadToken: 'upload-token',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    completedFileId: null,
    error: null,
    completedAt: null,
    updatedAt: now,
  }
}
