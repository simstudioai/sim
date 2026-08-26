/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertAuthBinding: vi.fn(),
  completeSession: vi.fn(),
  finalizePurpose: vi.fn(),
  getOwnedSession: vi.fn(),
  getPrincipalSession: vi.fn(),
  reauthorizeWorkspacePurpose: vi.fn(),
  getWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mocks.getWorkspaceFile,
}))

vi.mock('@/lib/uploads/upload-session/service', () => ({
  abortUploadSession: vi.fn(),
  assertUploadSessionAuthBinding: mocks.assertAuthBinding,
  completeUploadSession: mocks.completeSession,
  createUploadPartUrls: vi.fn(),
  createUploadSession: vi.fn(),
  getOwnedUploadSession: mocks.getOwnedSession,
  getPrincipalUploadSession: mocks.getPrincipalSession,
}))

vi.mock('@/app/api/files/uploads/finalizers', () => ({
  finalizeUploadPurpose: mocks.finalizePurpose,
  finalizeWorkspaceFileUpload: vi.fn(),
  loadCompletedUploadPurpose: vi.fn(),
  loadCompletedWorkspaceFileUpload: vi.fn(),
}))

vi.mock('@/app/api/files/uploads/purposes', () => ({
  createPurposeUploadSession: vi.fn(),
  reauthorizeUploadPurpose: vi.fn(),
  reauthorizeWorkspaceUploadPurpose: mocks.reauthorizeWorkspacePurpose,
  resolveUploadAttributionUserId: vi.fn(),
}))

import {
  completeInternalUploadSession,
  readWorkspaceUploadSession,
} from '@/lib/uploads/upload-session/application'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'

const principal = {
  kind: 'session' as const,
  userId: 'user-1',
  sessionId: 'session-1',
}
const actor = { id: 'user-1', name: 'Ada', email: 'ada@example.com' }

describe('upload session application', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const session = workspaceUploadSession()
    mocks.getOwnedSession.mockResolvedValue(session)
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

  it('preserves the authenticated actor metadata through internal finalization', async () => {
    const request = new NextRequest('http://localhost/api/files/uploads/upload-1/complete', {
      method: 'POST',
    })

    await completeInternalUploadSession(
      principal,
      { uploadId: 'upload-1', uploadToken: 'upload-token', actor },
      request
    )

    expect(mocks.finalizePurpose).toHaveBeenCalledWith(
      expect.objectContaining({ actor, principal, request })
    )
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

  /**
   * The resource documents `file` as the registered file after finalization,
   * and a caller polling a transfer it lost track of is exactly who needs it —
   * it is the only way to learn the id the upload produced without having held
   * the `complete` response. The read answered `null` unconditionally, so that
   * caller could see a session reach `completed` and still never learn what it
   * had created.
   */
  it('returns the registered file once the session has completed', async () => {
    const completed = { ...workspaceUploadSession(), status: 'completed' as const, completedFileId: 'file-1' }
    mocks.getOwnedSession.mockResolvedValue(completed)
    mocks.getPrincipalSession.mockResolvedValue(completed)
    mocks.getWorkspaceFile.mockResolvedValue({ id: 'file-1', name: 'file.txt' })

    const { file } = await readWorkspaceUploadSession(principal, {
      uploadId: 'upload-1',
      workspaceId: 'workspace-1',
      uploadToken: 'upload-token',
    })

    expect(file).toEqual({ id: 'file-1', name: 'file.txt' })
    expect(mocks.getWorkspaceFile).toHaveBeenCalledWith('workspace-1', 'file-1')
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

  /** A completed session whose file was since deleted has nothing to address. */
  it('answers null when the completed file is gone', async () => {
    const gone = { ...workspaceUploadSession(), status: 'completed' as const, completedFileId: 'file-1' }
    mocks.getOwnedSession.mockResolvedValue(gone)
    mocks.getPrincipalSession.mockResolvedValue(gone)
    mocks.getWorkspaceFile.mockResolvedValue(null)

    const { file } = await readWorkspaceUploadSession(principal, {
      uploadId: 'upload-1',
      workspaceId: 'workspace-1',
      uploadToken: 'upload-token',
    })

    expect(file).toBeNull()
  })

  it('does not return a session whose re-authorization fails', async () => {
    mocks.reauthorizeWorkspacePurpose.mockRejectedValueOnce(new Error('Upload session not found'))

    await expect(
      readWorkspaceUploadSession(principal, {
        uploadId: 'upload-1',
        workspaceId: 'workspace-1',
        uploadToken: 'upload-token',
      })
    ).rejects.toThrow('Upload session not found')
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
