/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { buildWorkspaceFileFolderPathMap } from './workspace-file-folder-manager'

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
})
