/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockInsertReturning,
  mockSelectLimit,
  mockRecordAudit,
  mockCaptureServerEvent,
  mockGetWorkspaceFile,
  mockRegisterUploadedWorkspaceFile,
  mockNotifyWorkspaceFilesChanged,
} = vi.hoisted(() => ({
  mockInsertReturning: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockRegisterUploadedWorkspaceFile: vi.fn(),
  mockNotifyWorkspaceFilesChanged: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({ returning: mockInsertReturning })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: mockSelectLimit })),
        })),
      })),
    })),
  },
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_UPLOADED: 'file.uploaded' },
  AuditResourceType: { WORKSPACE: 'workspace' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))
vi.mock('@/lib/uploads/config', () => ({ getServeStoragePrefix: () => 's3' }))
vi.mock('@/lib/uploads/upload-session/service', () => ({
  UploadSessionError: class UploadSessionError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
    }
  },
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
  registerUploadedWorkspaceFile: mockRegisterUploadedWorkspaceFile,
}))
vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkspaceFilesChanged: mockNotifyWorkspaceFilesChanged,
}))

import { finalizeUploadPurpose } from '@/app/api/files/uploads/finalizers'

const now = new Date('2026-08-04T12:00:00.000Z')
const actor = { id: 'user-1', name: 'Ada', email: 'ada@example.com' }
const metadataRow = {
  id: 'file-1',
  key: 'workspace-logos/upload-1-logo.png',
  userId: actor.id,
  workspaceId: 'workspace-1',
  folderId: null,
  context: 'workspace-logos',
  chatId: null,
  messageId: null,
  originalName: 'logo.png',
  displayName: 'logo.png',
  contentType: 'image/png',
  size: 128,
  sizeBytes: 128,
  deletedAt: null,
  uploadedAt: now,
  updatedAt: now,
  contentUpdatedAt: now,
}
const uploadSession = {
  id: 'upload-1',
  workspaceId: 'workspace-1',
  userId: actor.id,
  knowledgeBaseId: null,
  workflowId: null,
  executionId: null,
  purpose: 'workspace_logo' as const,
  method: 'put' as const,
  storageContext: 'workspace-logos' as const,
  storageKey: metadataRow.key,
  storageProvider: 's3' as const,
  providerUploadId: null,
  fileName: 'logo.png',
  contentType: 'image/png',
  fileSize: 128,
  status: 'uploading' as const,
  metadata: {},
  uploadToken: 'signed-token',
  createdAt: now,
  expiresAt: new Date('2026-08-05T12:00:00.000Z'),
  completedFileId: null,
  error: null,
  completedAt: null,
  updatedAt: now,
}
const workspaceFile = {
  id: 'wf-1',
  workspaceId: 'workspace-1',
  name: 'report.csv',
  key: 'workspace/workspace-1/upload-1-report.csv',
  path: '/api/files/serve/s3/workspace%2Fworkspace-1%2Fupload-1-report.csv?context=workspace',
  size: 128,
  type: 'text/csv',
  uploadedBy: actor.id,
  folderId: null,
  deletedAt: null,
  uploadedAt: now,
  updatedAt: now,
}

describe('upload purpose finalizers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits workspace-logo side effects only for the metadata insert winner', async () => {
    mockSelectLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([metadataRow])
    mockInsertReturning.mockResolvedValueOnce([metadataRow])
    const request = new NextRequest('http://localhost/api/files/uploads/upload-1/complete')

    const first = await finalizeUploadPurpose({ session: uploadSession, actor, request })
    const retry = await finalizeUploadPurpose({ session: uploadSession, actor, request })

    expect(first.value).toEqual({
      path: `/api/files/serve/s3/${encodeURIComponent(metadataRow.key)}?context=workspace-logos`,
      key: metadataRow.key,
      name: 'logo.png',
      size: 128,
      type: 'image/png',
    })
    expect(retry.value).toEqual(first.value)
    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1)
  })

  it('rejects a storage key already bound to a different owner', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ ...metadataRow, userId: 'other-user' }])

    await expect(
      finalizeUploadPurpose({
        session: uploadSession,
        actor,
        request: new NextRequest('http://localhost/api/files/uploads/upload-1/complete'),
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })

  it('rejects a replay after its metadata was archived', async () => {
    mockSelectLimit.mockResolvedValueOnce([
      { ...metadataRow, deletedAt: new Date('2026-08-04T13:00:00.000Z') },
    ])

    await expect(
      finalizeUploadPurpose({
        session: uploadSession,
        actor,
        request: new NextRequest('http://localhost/api/files/uploads/upload-1/complete'),
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mockInsertReturning).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })

  it('emits workspace-file side effects only for the metadata insert winner', async () => {
    const workspaceSession = {
      ...uploadSession,
      purpose: 'workspace_file' as const,
      storageContext: 'workspace' as const,
      storageKey: workspaceFile.key,
      fileName: workspaceFile.name,
      contentType: workspaceFile.type,
    }
    mockRegisterUploadedWorkspaceFile
      .mockResolvedValueOnce({ file: { id: workspaceFile.id }, created: true })
      .mockResolvedValueOnce({ file: { id: workspaceFile.id }, created: false })
    mockGetWorkspaceFile.mockResolvedValue(workspaceFile)
    const request = new NextRequest('http://localhost/api/files/uploads/upload-1/complete')

    const first = await finalizeUploadPurpose({ session: workspaceSession, actor, request })
    const retry = await finalizeUploadPurpose({ session: workspaceSession, actor, request })

    expect(retry.value).toEqual(first.value)
    expect(mockNotifyWorkspaceFilesChanged).toHaveBeenCalledTimes(1)
    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1)
  })

  it('rejects a workspace-file replay after its metadata was archived', async () => {
    const workspaceSession = {
      ...uploadSession,
      purpose: 'workspace_file' as const,
      storageContext: 'workspace' as const,
      storageKey: workspaceFile.key,
      fileName: workspaceFile.name,
      contentType: workspaceFile.type,
    }
    mockRegisterUploadedWorkspaceFile.mockResolvedValueOnce({
      file: { id: workspaceFile.id },
      created: false,
    })
    mockGetWorkspaceFile.mockResolvedValueOnce({ ...workspaceFile, deletedAt: now })

    await expect(
      finalizeUploadPurpose({
        session: workspaceSession,
        actor,
        request: new NextRequest('http://localhost/api/files/uploads/upload-1/complete'),
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mockNotifyWorkspaceFilesChanged).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})
