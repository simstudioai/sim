import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { dbChainMockFns } from '@sim/testing/mocks/database.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { uploadSessionMock } from '@sim/testing/mocks/upload-session.mock'
import { uploadsConfigMock } from '@sim/testing/mocks/uploads-config.mock'
import { usersQueriesMock, usersQueriesMockFns } from '@sim/testing/mocks/users-queries.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/uploads/config', () => uploadsConfigMock)
vi.mock('@/lib/uploads/upload-session/service', () => uploadSessionMock)
vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/users/queries', () => usersQueriesMock)

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

usersQueriesMockFns.mockGetUserEmailsByIds.mockImplementation(
  async () => new Map([['user-1', 'ada@example.com']])
)

const mockCaptureServerEvent = posthogServerMockFns.mockCaptureServerEvent
const mockRecordAudit = auditMockFns.mockRecordAudit
const mockNotifyWorkspaceFilesChanged = realtimeNotifyMockFns.mockNotifyWorkspaceFilesChanged
const mockGetWorkspaceFile = workspaceUploadsMockFns.mockGetWorkspaceFile
const mockRegisterUploadedWorkspaceFile = workspaceUploadsMockFns.mockRegisterUploadedWorkspaceFile
const mockInsertReturning = dbChainMockFns.returning
const mockSelectLimit = dbChainMockFns.limit

const now = new Date('2026-08-04T12:00:00.000Z')
const actor = { id: 'user-1', name: 'Ada', email: 'ada@example.com' }
const principal = createSessionPrincipal({ userId: actor.id })
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

  it.each(REPLAY_VIA_IDEMPOTENT_FINALIZER)(
    'does not mark %s as loader-backed, so its replay re-runs the idempotent finalizer',
    async (purpose) => {
      mockSelectLimit.mockResolvedValue([])
      mockInsertReturning.mockResolvedValue([metadataRow])
      const request = createMockRequest({
        url: 'http://localhost/api/files/uploads/upload-1/complete',
      })

      const finalized = await finalizeUploadPurpose({
        session: { ...uploadSession, purpose },
        actor,
        principal,
        request,
      })

      expect(finalized.completedFileId).toBeUndefined()
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
  it('emits workspace-logo side effects only for the metadata insert winner', async () => {
    mockSelectLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([metadataRow])
    mockInsertReturning.mockResolvedValueOnce([metadataRow])
    const request = createMockRequest({
      url: 'http://localhost/api/files/uploads/upload-1/complete',
    })

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
        request: createMockRequest({ url: 'http://localhost/api/files/uploads/upload-1/complete' }),
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
        request: createMockRequest({ url: 'http://localhost/api/files/uploads/upload-1/complete' }),
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mockInsertReturning).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
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
        request: createMockRequest({ url: 'http://localhost/api/files/uploads/upload-1/complete' }),
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
      request: createMockRequest({ url: 'http://localhost/api/files/uploads/upload-1/complete' }),
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
        request: createMockRequest({ url: 'http://localhost/api/files/uploads/upload-1/complete' }),
      })
    ).rejects.toThrow('Access revoked')
    expect(mockRegisterUploadedWorkspaceFile).not.toHaveBeenCalled()
    expect(mockNotifyWorkspaceFilesChanged).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
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
    const request = createMockRequest({
      url: 'http://localhost/api/files/uploads/upload-1/complete',
    })

    await finalizeUploadPurpose({
      session: workspaceSession,
      actor: { id: 'current-owner' },
      principal: createWorkspaceApiKeyPrincipal(),
      request,
    })

    expect(mockRegisterUploadedWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'current-owner' })
    )
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})
