/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorize, mockCreate, mockRelocate, mockAudit, mockNotify } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockCreate: vi.fn(),
  mockRelocate: vi.fn(),
  mockAudit: vi.fn(),
  mockNotify: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/workspace-operation-context', () => ({
  authorizeWorkspaceFileOperation: mockAuthorize,
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  assertWorkspaceFileItemsBelongToWorkspace: mockAuthorize,
  createWorkspaceFileFolderAtPath: mockCreate,
  relocateWorkspaceFileFolderByPath: mockRelocate,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { FOLDER_CREATED: 'folder.created', FOLDER_MOVED: 'folder.moved' },
  AuditResourceType: { FOLDER: 'folder' },
  recordAudit: mockAudit,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mockNotify }))

import {
  createWorkspaceFileFolderOperation,
  updateWorkspaceFileFolderOperation,
} from '@/lib/workspace-files/application/workspace-file-folders'

const folder = {
  id: 'folder-1',
  workspaceId: 'ws-1',
  userId: 'owner-1',
  name: 'Reports',
  parentId: null,
  sortOrder: 0,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

describe('workspace file folder operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthorize.mockResolvedValue({
      context: {
        workspaceId: 'ws-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'owner-1',
      },
      attribution: { attributedUserId: 'user-1', actor: { kind: 'session', userId: 'user-1' } },
    })
  })

  it('creates a canonical path folder through the manager primitive', async () => {
    mockCreate.mockResolvedValue({ folder, path: '/Reports' })
    const result = await createWorkspaceFileFolderOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'ws-1', path: '/Reports' },
    })

    expect(result.folder.path).toBe('/Reports')
    expect(mockCreate).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      path: '/Reports',
    })
    expect(mockAudit).toHaveBeenCalledOnce()
    expect(mockNotify).toHaveBeenCalledOnce()
  })

  it('relocates a canonical path folder without invoking legacy orchestration', async () => {
    mockRelocate.mockResolvedValue({ folder, path: '/Archive/Reports' })
    const result = await updateWorkspaceFileFolderOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workspaceId: 'ws-1',
        path: '/Reports',
        destinationPath: '/Archive/Reports',
      },
    })

    expect(result.folder.path).toBe('/Archive/Reports')
    expect(mockRelocate).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      path: '/Reports',
      destinationPath: '/Archive/Reports',
    })
    expect(mockAudit).toHaveBeenCalledOnce()
    expect(mockNotify).toHaveBeenCalledOnce()
  })
})
