/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockCreateUploadSession,
  mockCreateInternalPurposeUploadSession,
  mockCompleteInternalUploadSession,
  mockGetOwnedUploadSession,
  mockCompleteUploadSession,
  mockGetUserEntityPermissions,
  mockAuthorizeWorkflow,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCreateUploadSession: vi.fn(),
  mockCreateInternalPurposeUploadSession: vi.fn(),
  mockCompleteInternalUploadSession: vi.fn(),
  mockGetOwnedUploadSession: vi.fn(),
  mockCompleteUploadSession: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockAuthorizeWorkflow: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))

vi.mock('@/lib/uploads/upload-session/service', () => ({
  UploadSessionError: class UploadSessionError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
    }
  },
  createUploadSession: mockCreateUploadSession,
  getOwnedUploadSession: mockGetOwnedUploadSession,
  completeUploadSession: mockCompleteUploadSession,
  createUploadPartUrls: vi.fn(),
  abortUploadSession: vi.fn(),
}))

vi.mock('@/lib/uploads/upload-session/application', () => ({
  createInternalPurposeUploadSession: mockCreateInternalPurposeUploadSession,
  completeInternalUploadSession: mockCompleteInternalUploadSession,
  issueInternalUploadPartUrls: vi.fn(),
  abortInternalUploadSession: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflow,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  assertWorkspaceFileFolderTarget: vi.fn(),
  getWorkspaceFile: vi.fn(),
  registerUploadedWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: vi.fn() }))

import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
import { POST as completeUpload } from '@/app/api/files/uploads/[uploadId]/complete/route'
import { POST as createUpload } from '@/app/api/files/uploads/route'

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
    vi.clearAllMocks()
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
    const request = new NextRequest('http://localhost/api/files/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purpose: 'profile_picture',
        name: 'avatar.png',
        contentType: 'image/png',
        size: 128,
      }),
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

  it('creates a PUT session for an empty workspace file', async () => {
    mockCreateInternalPurposeUploadSession.mockResolvedValue({
      ...session({
        workspaceId: 'workspace-1',
        purpose: 'workspace_file',
        storageContext: 'workspace',
        storageKey: 'workspace/workspace-1/empty.md',
        fileName: 'empty.md',
        contentType: 'text/markdown',
        fileSize: 0,
      }),
      transfer: {
        method: 'put',
        url: 'https://storage.example.com/upload',
        headers: { 'Content-Type': 'text/markdown' },
      },
    })
    const request = new NextRequest('http://localhost/api/files/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purpose: 'workspace_file',
        workspaceId: 'workspace-1',
        name: 'empty.md',
        contentType: 'text/markdown',
        size: 0,
      }),
    })

    const response = await createUpload(request)

    expect(response.status).toBe(201)
    expect(mockCreateInternalPurposeUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session' }),
      expect.objectContaining({ purpose: 'workspace_file', size: 0 }),
      request
    )
    await expect(response.json()).resolves.toMatchObject({
      data: { session: { purpose: 'workspace_file', size: 0 } },
    })
  })

  it('preserves the 5 GiB direct-to-storage limit for mothership attachments', async () => {
    mockCreateInternalPurposeUploadSession.mockResolvedValue({
      ...session({
        workspaceId: 'workspace-1',
        purpose: 'mothership_attachment',
        method: 'multipart',
        storageContext: 'mothership',
        storageKey: 'mothership/workspace-1/archive.zip',
        fileName: 'archive.zip',
        contentType: 'application/zip',
        fileSize: MAX_WORKSPACE_FILE_SIZE,
      }),
      transfer: { method: 'multipart', partSize: 8 * 1024 * 1024, partCount: 640 },
    })
    const request = new NextRequest('http://localhost/api/files/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purpose: 'mothership_attachment',
        workspaceId: 'workspace-1',
        name: 'archive.zip',
        contentType: 'application/zip',
        size: MAX_WORKSPACE_FILE_SIZE,
      }),
    })

    const response = await createUpload(request)

    expect(response.status).toBe(201)
    expect(mockCreateInternalPurposeUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session' }),
      expect.objectContaining({ purpose: 'mothership_attachment', size: MAX_WORKSPACE_FILE_SIZE }),
      request
    )
  })

  it('rejects mothership attachments above the 5 GiB direct-to-storage limit', async () => {
    const request = new NextRequest('http://localhost/api/files/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purpose: 'mothership_attachment',
        workspaceId: 'workspace-1',
        name: 'archive.zip',
        contentType: 'application/zip',
        size: MAX_WORKSPACE_FILE_SIZE + 1,
      }),
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
    const request = new NextRequest('http://localhost/api/files/uploads/upload-1/complete', {
      method: 'POST',
      headers: { 'upload-token': 'signed-token' },
    })

    const response = await completeUpload(request, {
      params: Promise.resolve({ uploadId: 'upload-1' }),
    })
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
    const request = new NextRequest('http://localhost/api/files/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })

    const response = await createUpload(request)

    expect(response.status).toBe(401)
    expect(mockCreateInternalPurposeUploadSession).not.toHaveBeenCalled()
  })
})
