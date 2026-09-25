import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCaptureServerEvent, mockRecordAudit, mockUploadWorkspaceFile } = vi.hoisted(() => ({
  mockCaptureServerEvent: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_UPLOADED: 'file.uploaded' },
  AuditResourceType: { FILE: 'file' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  FileConflictError: class FileConflictError extends Error {
    constructor(name: string) {
      super(`A file named "${name}" already exists in this workspace`)
      this.name = 'FileConflictError'
    }
  },
  uploadWorkspaceFile: mockUploadWorkspaceFile,
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { FileConflictError } from '@/lib/uploads/contexts/workspace'
import {
  MAX_WORKSPACE_FILE_CONTENT_BYTES,
  performCreateWorkspaceFile,
} from '@/lib/workspace-files/orchestration'

const WORKSPACE_ID = 'workspace-1'
const USER_ID = 'user-1'
const CREATED_FILE = {
  id: 'wf_created',
  workspaceId: WORKSPACE_ID,
  name: 'untitled.md',
  key: 'workspace/workspace-1/untitled.md',
  path: '/api/files/serve/untitled.md',
  url: '/api/files/serve/untitled.md',
  size: 0,
  type: 'text/markdown',
  uploadedBy: USER_ID,
  folderId: null,
  folderPath: null,
  deletedAt: null,
  uploadedAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
  context: 'workspace' as const,
}

describe('performCreateWorkspaceFile', () => {
  beforeEach(() => {
    mockUploadWorkspaceFile.mockResolvedValue(CREATED_FILE)
  })

  it('rejects decoded content above the content-update limit before storage I/O', async () => {
    const result = await performCreateWorkspaceFile({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      name: 'too-large.md',
      contentType: 'text/markdown',
      content: Buffer.alloc(MAX_WORKSPACE_FILE_CONTENT_BYTES + 1),
    })

    expect(result).toEqual({
      success: false,
      error: 'File size exceeds 50MB limit',
      errorCode: 'payload_too_large',
    })
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })

  it('classifies an exact-name collision as conflict and records no audit', async () => {
    mockUploadWorkspaceFile.mockRejectedValue(new FileConflictError('untitled.md'))

    const result = await performCreateWorkspaceFile({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      name: 'untitled.md',
      contentType: 'text/markdown',
    })

    expect(result).toEqual({
      success: false,
      error: 'A file named "untitled.md" already exists in this workspace',
      errorCode: 'conflict',
    })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })

  it('preserves classified folder failures and keeps unexpected faults internal', async () => {
    mockUploadWorkspaceFile.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Target folder not found')
    )

    const missingFolder = await performCreateWorkspaceFile({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      name: 'untitled.md',
      contentType: 'text/markdown',
      folderId: 'missing',
    })

    expect(missingFolder).toEqual({
      success: false,
      error: 'Target folder not found',
      errorCode: 'not_found',
    })

    mockUploadWorkspaceFile.mockRejectedValueOnce(new Error('connection terminated'))

    const unexpected = await performCreateWorkspaceFile({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      name: 'untitled.md',
      contentType: 'text/markdown',
    })

    expect(unexpected).toEqual({
      success: false,
      error: 'connection terminated',
      errorCode: 'internal',
    })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})
