/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'
import {
  buildWorkspaceFileFolderPathMap,
  ensureWorkspaceFileFolderPath,
  normalizeWorkspaceFileItemName,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'

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

  it('rejects oversized ensured paths before persisting any folders', async () => {
    await expect(
      ensureWorkspaceFileFolderPath({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        pathSegments: Array.from({ length: MAX_FOLDER_PATH_SEGMENTS + 1 }, () => 'nested'),
      })
    ).rejects.toThrow(`Folder paths cannot exceed ${MAX_FOLDER_PATH_SEGMENTS} segments`)
  })
})
