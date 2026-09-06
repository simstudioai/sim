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
vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: vi.fn(async () => new Map([['user-1', 'ada@example.com']])),
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))

import {
  bindWorkspaceFileUploadProvenance,
  WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY,
} from '@/lib/uploads/upload-session/workspace-file-provenance'
import {
  finalizeUploadPurpose,
  finalizeWorkspaceFileUpload,
  loadCompletedUploadPurpose,
} from '@/app/api/files/uploads/finalizers'
import type { InternalUploadPurpose } from '@/app/api/files/uploads/purposes'

const now = new Date('2026-08-04T12:00:00.000Z')
const actor = { id: 'user-1', name: 'Ada', email: 'ada@example.com' }
const principal = { kind: 'session' as const, userId: actor.id, sessionId: 'session-1' }
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
  finalKey: metadataRow.key,
  storageProvider: 's3' as const,
  providerUploadId: null,
  providerObjectVersion: null,
  fileName: 'logo.png',
  contentType: 'image/png',
  fileSize: 128,
  partSize: null,
  partCount: null,
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

/**
 * How each purpose replays a completion. `Record` over the union is a
 * compile-time completeness gate: adding a purpose fails to build until its
 * replay behavior is declared here.
 */
const REPLAY_ROUTE: Record<InternalUploadPurpose, 'loader' | 'idempotent-finalizer'> = {
  workspace_file: 'loader',
  profile_picture: 'idempotent-finalizer',
  workspace_logo: 'idempotent-finalizer',
  mothership_attachment: 'idempotent-finalizer',
  execution_attachment: 'idempotent-finalizer',
}

const purposesReplayedBy = (route: 'loader' | 'idempotent-finalizer') =>
  (Object.keys(REPLAY_ROUTE) as InternalUploadPurpose[]).filter((p) => REPLAY_ROUTE[p] === route)

describe('completion replay contract', () => {
  const REPLAY_VIA_IDEMPOTENT_FINALIZER = purposesReplayedBy('idempotent-finalizer')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(REPLAY_VIA_IDEMPOTENT_FINALIZER)(
    'does not mark %s as loader-backed, so its replay re-runs the idempotent finalizer',
    async (purpose) => {
      mockSelectLimit.mockResolvedValue([])
      mockInsertReturning.mockResolvedValue([metadataRow])
      const request = new NextRequest('http://localhost/api/files/uploads/upload-1/complete')

      const finalized = await finalizeUploadPurpose({
        session: { ...uploadSession, purpose },
        actor,
        principal,
        request,
      })

      expect(finalized.completedFileId).toBeUndefined()
    }
  )

  it.each(REPLAY_VIA_IDEMPOTENT_FINALIZER)(
    'reports a classified error rather than an unhandled crash if %s ever reaches the loader',
    async (purpose) => {
      await expect(loadCompletedUploadPurpose({ ...uploadSession, purpose })).rejects.toMatchObject(
        { code: 'internal' }
      )
    }
  )

  it('loads workspace_file from its durable record on replay', async () => {
    mockGetWorkspaceFile.mockResolvedValueOnce(workspaceFile)

    const loaded = await loadCompletedUploadPurpose({
      ...uploadSession,
      purpose: purposesReplayedBy('loader')[0],
      completedFileId: workspaceFile.id,
    })

    expect(loaded).toMatchObject({ id: workspaceFile.id })
    expect(mockGetWorkspaceFile).toHaveBeenCalledTimes(1)
  })
})

describe('upload purpose finalizers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits workspace-logo side effects only for the metadata insert winner', async () => {
    mockSelectLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([metadataRow])
    mockInsertReturning.mockResolvedValueOnce([metadataRow])
    const request = new NextRequest('http://localhost/api/files/uploads/upload-1/complete')

    const first = await finalizeUploadPurpose({ session: uploadSession, actor, principal, request })
    const retry = await finalizeUploadPurpose({ session: uploadSession, actor, principal, request })

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
        principal,
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
        principal,
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

    const first = await finalizeUploadPurpose({
      session: workspaceSession,
      actor,
      principal,
      request,
    })
    const retry = await finalizeUploadPurpose({
      session: workspaceSession,
      actor,
      principal,
      request,
    })

    expect(retry.value).toEqual(first.value)
    expect(mockRegisterUploadedWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({ uploadSessionId: workspaceSession.id })
    )
    expect(mockNotifyWorkspaceFilesChanged).toHaveBeenCalledTimes(1)
    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1)
  })

  it.each(['exact', 'unknown'] as const)(
    'recovers private %s provenance from session state before registering bytes',
    async (status) => {
      const secretProvenance =
        status === 'exact'
          ? { status, entries: [{ encryptedValue: 'fixture-ciphertext', sourceUserId: actor.id }] }
          : { status }
      const session = {
        ...uploadSession,
        purpose: 'workspace_file' as const,
        storageContext: 'workspace' as const,
        storageKey: workspaceFile.key,
        fileName: workspaceFile.name,
        contentType: workspaceFile.type,
        metadata: {
          [WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY]: bindWorkspaceFileUploadProvenance(
            'workspace-1',
            secretProvenance
          ),
        },
      }
      mockRegisterUploadedWorkspaceFile.mockResolvedValue({
        file: { id: workspaceFile.id },
        created: true,
      })
      mockGetWorkspaceFile.mockResolvedValue(workspaceFile)
      const authorize = vi.fn(async () => {})
      const finalized = await finalizeWorkspaceFileUpload({
        session,
        actor,
        principal,
        source: 'api',
        authorizeBeforeRegistration: authorize,
        request: new NextRequest('http://localhost/api/files/uploads/upload-1/complete'),
      })
      expect(authorize).toHaveBeenCalledBefore(mockRegisterUploadedWorkspaceFile)
      expect(mockRegisterUploadedWorkspaceFile).toHaveBeenCalledWith(
        expect.objectContaining({
          secretProvenance,
          uploadSessionId: session.id,
          workspaceId: 'workspace-1',
          key: session.storageKey,
        })
      )
      expect(JSON.stringify(finalized)).not.toContain('fixture-ciphertext')
    }
  )

  it('does not turn a malformed stored private binding into an ordinary safe upload', async () => {
    mockRegisterUploadedWorkspaceFile.mockResolvedValue({
      file: { id: workspaceFile.id },
      created: true,
    })
    mockGetWorkspaceFile.mockResolvedValue(workspaceFile)
    await finalizeWorkspaceFileUpload({
      session: {
        ...uploadSession,
        purpose: 'workspace_file',
        metadata: { [WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY]: null },
      },
      actor,
      principal,
      source: 'api',
      request: new NextRequest('http://localhost/api/files/uploads/upload-1/complete'),
    })
    expect(mockRegisterUploadedWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: { status: 'unknown' } })
    )
  })

  it('does not register classified bytes after finalization authorization is revoked', async () => {
    await expect(
      finalizeWorkspaceFileUpload({
        session: {
          ...uploadSession,
          purpose: 'workspace_file',
          metadata: {
            [WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY]: bindWorkspaceFileUploadProvenance(
              'workspace-1',
              { status: 'unknown' }
            ),
          },
        },
        actor,
        principal,
        source: 'api',
        authorizeBeforeRegistration: async () => {
          throw new Error('Access revoked')
        },
        request: new NextRequest('http://localhost/api/files/uploads/upload-1/complete'),
      })
    ).rejects.toThrow('Access revoked')
    expect(mockRegisterUploadedWorkspaceFile).not.toHaveBeenCalled()
    expect(mockNotifyWorkspaceFilesChanged).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
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
        principal,
        request: new NextRequest('http://localhost/api/files/uploads/upload-1/complete'),
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mockNotifyWorkspaceFilesChanged).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })

  it('uses the current billing owner only for workspace-key legacy attribution', async () => {
    const workspaceSession = {
      ...uploadSession,
      purpose: 'workspace_file' as const,
      storageContext: 'workspace' as const,
      storageKey: workspaceFile.key,
      finalKey: workspaceFile.key,
      fileName: workspaceFile.name,
      contentType: workspaceFile.type,
    }
    mockRegisterUploadedWorkspaceFile.mockResolvedValueOnce({
      file: { id: workspaceFile.id },
      created: true,
    })
    mockGetWorkspaceFile.mockResolvedValue(workspaceFile)
    const request = new NextRequest('http://localhost/api/files/uploads/upload-1/complete')

    await finalizeUploadPurpose({
      session: workspaceSession,
      actor: { id: 'current-owner' },
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'key-1',
      },
      request,
    })

    expect(mockRegisterUploadedWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'current-owner' })
    )
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})
