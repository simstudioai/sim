/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import {
  buildWorkspaceFileFolderPathMap,
  normalizeWorkspaceFileItemName,
  WorkspaceFileFolderConflictError,
  WorkspaceFileItemsNotFoundError,
  WorkspaceFileMoveConflictError,
} from './workspace-file-folder-manager'

describe('workspace file folder paths', () => {
  it('builds nested paths from parent relationships', () => {
    const paths = buildWorkspaceFileFolderPathMap([
      { id: 'reports', name: 'Reports', parentId: null },
      { id: 'quarterly', name: 'Quarterly', parentId: 'reports' },
      { id: 'archive', name: 'Archive', parentId: null },
    ])

    expect(paths.get('reports')).toBe('Reports')
    expect(paths.get('quarterly')).toBe('Reports/Quarterly')
    expect(paths.get('archive')).toBe('Archive')
  })

  it('rejects names that would create ambiguous paths', () => {
    expect(normalizeWorkspaceFileItemName('Reports', 'Folder')).toBe('Reports')
    expect(() => normalizeWorkspaceFileItemName('A/B', 'Folder')).toThrow(
      'Folder name cannot contain path separators or dot segments'
    )
    expect(() => normalizeWorkspaceFileItemName('..', 'File')).toThrow(
      'File name cannot contain path separators or dot segments'
    )
  })
})

describe('workspace file folder failure classification', () => {
  it('classifies a duplicate folder name as a conflict for every surface', () => {
    const error = new WorkspaceFileFolderConflictError('Reports')
    const classified = asOrchestrationError(error)

    expect(classified?.code).toBe('conflict')
    expect(statusForOrchestrationError(classified?.code)).toBe(409)
    expect(error.message).toBe('A folder named "Reports" already exists in this location')
  })

  it('classifies a destination name collision as a conflict', () => {
    const classified = asOrchestrationError(new WorkspaceFileMoveConflictError('report.pdf'))

    expect(classified?.code).toBe('conflict')
    expect(statusForOrchestrationError(classified?.code)).toBe(409)
  })

  it('classifies missing items as not found', () => {
    const classified = asOrchestrationError(
      new WorkspaceFileItemsNotFoundError(['file-1'], ['folder-1'])
    )

    expect(classified?.code).toBe('not_found')
    expect(statusForOrchestrationError(classified?.code)).toBe(404)
    expect(classified?.message).toBe(
      'Workspace file items not found (files: file-1; folders: folder-1)'
    )
  })

  it('classifies a conflict raised inside a wrapping transaction error', () => {
    const wrapped = new Error('insert into "folder" ...', {
      cause: new WorkspaceFileFolderConflictError('Reports'),
    })

    expect(asOrchestrationError(wrapped)?.code).toBe('conflict')
  })
})
