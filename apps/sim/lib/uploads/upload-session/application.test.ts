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
  reauthorizeWorkspacePurpose: vi.fn(),
}))

vi.mock('@/lib/uploads/upload-session/service', () => ({
  abortUploadSession: vi.fn(),
  assertUploadSessionAuthBinding: mocks.assertAuthBinding,
  completeUploadSession: mocks.completeSession,
  createUploadPartUrls: vi.fn(),
  createUploadSession: vi.fn(),
  getOwnedUploadSession: mocks.getOwnedSession,
  getPrincipalUploadSession: vi.fn(),
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

import { completeInternalUploadSession } from '@/lib/uploads/upload-session/application'
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
