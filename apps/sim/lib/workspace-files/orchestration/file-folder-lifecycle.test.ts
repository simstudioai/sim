/**
 * Failure classification. Every `perform*` here is consumed by a public v2 route
 * that maps `errorCode` straight to an HTTP status, so a manager failure that
 * arrives unclassified silently becomes a 500 for what is really a caller-fixable
 * 400 or 404. These pin the mapping rather than the happy paths.
 */

import { auditMock } from '@sim/testing/mocks/audit.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)

vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

vi.mock('@sim/audit', () => auditMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  performDeleteWorkspaceFileFolderByPath,
  performMoveWorkspaceFileItems,
  performRenameWorkspaceFile,
  performUpdateWorkspaceFileFolder,
} from '@/lib/workspace-files/orchestration'

const mockMoveWorkspaceFileItems = workspaceUploadsMockFns.mockMoveWorkspaceFileItems
const mockUpdateWorkspaceFileFolder = workspaceUploadsMockFns.mockUpdateWorkspaceFileFolder
const mockRenameWorkspaceFile = workspaceUploadsMockFns.mockRenameWorkspaceFile
const mockDeleteWorkspaceFileFolderByPath =
  workspaceUploadsMockFns.mockDeleteWorkspaceFileFolderByPath

const WS = 'workspace-1'
const USER = 'user-1'

describe('workspace file orchestration error classification', () => {
  it('maps a missing move target to not_found, not internal', async () => {
    mockMoveWorkspaceFileItems.mockRejectedValue(
      new OrchestrationError('not_found', 'Target folder not found')
    )

    const result = await performMoveWorkspaceFileItems({
      workspaceId: WS,
      userId: USER,
      fileIds: ['wf_1'],
      targetFolderId: 'fold_missing',
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('not_found')
    expect(result.error).toBe('Target folder not found')
  })

  it('maps a self-descendant move to validation, not internal', async () => {
    mockMoveWorkspaceFileItems.mockRejectedValue(
      new OrchestrationError('validation', 'Cannot move a folder into one of its descendants')
    )

    const result = await performMoveWorkspaceFileItems({
      workspaceId: WS,
      userId: USER,
      folderIds: ['fold_1'],
      targetFolderId: 'fold_child',
    })

    expect(result.errorCode).toBe('validation')
  })

  it('classifies through a wrapper error chain, as drizzle produces inside a transaction', async () => {
    const wrapped = new Error('update "folder" set ... failed', {
      cause: new OrchestrationError('validation', 'Folder cannot be its own parent'),
    })
    mockUpdateWorkspaceFileFolder.mockRejectedValue(wrapped)

    const result = await performUpdateWorkspaceFileFolder({
      workspaceId: WS,
      folderId: 'fold_1',
      userId: USER,
      parentId: 'fold_1',
    })

    expect(result.errorCode).toBe('validation')
    expect(result.error).toBe('Folder cannot be its own parent')
  })

  it('leaves a genuinely unexpected fault as internal', async () => {
    mockRenameWorkspaceFile.mockRejectedValue(new Error('connection terminated unexpectedly'))

    const result = await performRenameWorkspaceFile({
      workspaceId: WS,
      fileId: 'wf_1',
      name: 'renamed.csv',
      userId: USER,
    })

    expect(result.errorCode).toBe('internal')
  })

  it('classifies a non-empty non-recursive folder delete as a conflict', async () => {
    mockDeleteWorkspaceFileFolderByPath.mockRejectedValue(
      new OrchestrationError('conflict', 'Folder is not empty')
    )

    const result = await performDeleteWorkspaceFileFolderByPath({
      workspaceId: WS,
      userId: USER,
      path: '/Reports',
      recursive: false,
    })

    expect(result).toEqual({
      success: false,
      error: 'Folder is not empty',
      errorCode: 'conflict',
    })
  })
})
