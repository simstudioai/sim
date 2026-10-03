import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { uploadSessionMock, uploadSessionMockFns } from '@sim/testing/mocks/upload-session.mock'
import { workspaceUploadsMock } from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateInternalPurposeUploadSession, mockCompleteInternalUploadSession } = vi.hoisted(
  () => ({
    mockCreateInternalPurposeUploadSession: vi.fn(),
    mockCompleteInternalUploadSession: vi.fn(),
  })
)

vi.mock('@/lib/uploads/upload-session/service', () => uploadSessionMock)

vi.mock('@/lib/uploads/upload-session/application', () => ({
  createInternalPurposeUploadSession: mockCreateInternalPurposeUploadSession,
  completeInternalUploadSession: mockCompleteInternalUploadSession,
  issueInternalUploadPartUrls: vi.fn(),
  abortInternalUploadSession: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)

vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
import { POST as completeUpload } from '@/app/api/files/uploads/[uploadId]/complete/route'
import { POST as createUpload } from '@/app/api/files/uploads/route'

const { mockGetOwnedUploadSession } = uploadSessionMockFns

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions
const mockGetSession = authMockFns.mockGetSession

const actor = { id: 'user-1', name: 'Ada', email: 'ada@example.com' }
const now = new Date('2026-08-04T12:00:00.000Z')

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'upload-1',
    workspaceId: null,
    userId: actor.id,
    knowledgeBaseId: null,
    workflowId: null,
    executionId: null,
    purpose: 'profile_picture',
    method: 'put',
    storageContext: 'profile-pictures',
    storageKey: 'profile-pictures/upload-1-avatar.png',
    finalKey: 'profile-pictures/upload-1-avatar.png',
    storageProvider: 's3',
    providerUploadId: null,
    providerObjectVersion: null,
    fileName: 'avatar.png',
    contentType: 'image/png',
    fileSize: 128,
    partSize: null,
    partCount: null,
    status: 'uploading',
    metadata: {},
    uploadToken: 'signed-token',
    createdAt: now,
    expiresAt: new Date('2026-08-05T12:00:00.000Z'),
    completedFileId: null,
    error: null,
    completedAt: null,
    updatedAt: now,
    ...overrides,
  }
}

describe('/api/files/uploads', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ user: actor, session: { id: 'session-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  it('creates a purpose-scoped PUT session without exposing write capability in the session', async () => {
    mockCreateInternalPurposeUploadSession.mockResolvedValue({
      ...session(),
      transfer: {
        method: 'put',
        url: 'https://storage.example.com/upload',
        headers: { 'Content-Type': 'image/png' },
      },
    })
    const request = createMockRequest({
      method: 'POST',
      url: 'http://localhost/api/files/uploads',
      body: {
        purpose: 'profile_picture',
        name: 'avatar.png',
        contentType: 'image/png',
        size: 128,
      },
    })

    const response = await createUpload(request)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(mockCreateInternalPurposeUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session', userId: actor.id }),
      expect.objectContaining({ purpose: 'profile_picture' }),
      request
    )
    expect(body.data).toMatchObject({
      session: {
        id: 'upload-1',
        purpose: 'profile_picture',
        status: 'uploading',
        result: null,
      },
      uploadToken: 'signed-token',
      transfer: { method: 'put' },
    })
    expect(body.data.session).not.toHaveProperty('uploadToken')
    expect(body.data.session).not.toHaveProperty('transfer')
  })

  it.each([
    { organizationId: 'org-1', contentType: 'application/pdf', size: 100 },
    { organizationId: 'org-1', contentType: 'image/svg+xml', size: 100 },
    { organizationId: 'org-1', contentType: 'image/png', size: 5 * 1024 * 1024 + 1 },
    { organizationId: 'org-1', workspaceId: 'ws-1', contentType: 'image/png', size: 100 },
  ])('rejects unsupported organization attachments before application loading', async (body) => {
    const response = await createUpload(
      createMockRequest({
        method: 'POST',
        url: 'http://localhost/api/files/uploads',
        body: { purpose: 'mothership_attachment', name: 'image.png', ...body },
      })
    )
    expect(response.status).toBe(400)
    expect(mockCreateInternalPurposeUploadSession).not.toHaveBeenCalled()
  })

  it('rejects mothership attachments above the 5 GiB direct-to-storage limit', async () => {
    const request = createMockRequest({
      method: 'POST',
      url: 'http://localhost/api/files/uploads',
      body: {
        purpose: 'mothership_attachment',
        workspaceId: 'workspace-1',
        name: 'archive.zip',
        contentType: 'application/zip',
        size: MAX_WORKSPACE_FILE_SIZE + 1,
      },
    })

    const response = await createUpload(request)

    expect(response.status).toBe(400)
    expect(mockCreateInternalPurposeUploadSession).not.toHaveBeenCalled()
  })

  it('reauthorizes a terminal request and returns only the terminal-safe session', async () => {
    const logoSession = session({
      workspaceId: 'workspace-1',
      purpose: 'workspace_logo',
      storageContext: 'workspace-logos',
      storageKey: 'workspace-logos/upload-1-logo.png',
      fileName: 'logo.png',
    })
    const result = {
      path: '/api/files/serve/s3/workspace-logos%2Fupload-1-logo.png?context=workspace-logos',
      key: 'workspace-logos/upload-1-logo.png',
      name: 'logo.png',
      size: 128,
      type: 'image/png',
    }
    mockGetOwnedUploadSession.mockReturnValue(logoSession)
    mockCompleteInternalUploadSession.mockResolvedValue({
      session: { ...logoSession, status: 'completed', completedAt: now },
      value: result,
      alreadyCompleted: false,
    })
    const request = createMockRequest({
      method: 'POST',
      url: 'http://localhost/api/files/uploads/upload-1/complete',
      headers: { 'upload-token': 'signed-token' },
    })

    const response = await completeUpload(request, createRouteContext({ uploadId: 'upload-1' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockCompleteInternalUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session' }),
      expect.objectContaining({
        uploadId: 'upload-1',
        actor: expect.objectContaining({ id: actor.id }),
      }),
      request
    )
    expect(body).toEqual({
      data: expect.objectContaining({
        id: 'upload-1',
        purpose: 'workspace_logo',
        status: 'completed',
        result,
      }),
    })
    expect(body.data).not.toHaveProperty('uploadToken')
    expect(body.data).not.toHaveProperty('transfer')
  })

  it('authenticates before parsing the request body', async () => {
    mockGetSession.mockResolvedValue(null)
    const request = createMockRequest({
      method: 'POST',
      url: 'http://localhost/api/files/uploads',
      headers: { 'Content-Type': 'application/json' },
      rawBody: '{not json',
    })

    const response = await createUpload(request)

    expect(response.status).toBe(401)
    expect(mockCreateInternalPurposeUploadSession).not.toHaveBeenCalled()
  })
})
