/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'
import {
  MAX_WORKSPACE_FILE_PATH_BYTES,
  parseRelativeWorkspaceFileCreatePath,
  parseWorkspaceFileCreatePath,
  workspaceFileVfsPath,
} from '@/lib/workspace-files/workspace-file-path'

describe('workspace file paths', () => {
  it('parses root-level and nested relative write paths', () => {
    expect(parseRelativeWorkspaceFileCreatePath('report.md')).toEqual({
      folderSegments: [],
      fileName: 'report.md',
      vfsPath: 'files/report.md',
    })
    expect(parseRelativeWorkspaceFileCreatePath('Reports/2026/report.md')).toEqual({
      folderSegments: ['Reports', '2026'],
      fileName: 'report.md',
      vfsPath: 'files/Reports/2026/report.md',
    })
  })

  it('preserves existing slash and whitespace normalization', () => {
    expect(parseRelativeWorkspaceFileCreatePath(' / Reports // 2026 / report.md / ')).toEqual({
      folderSegments: ['Reports', '2026'],
      fileName: 'report.md',
      vfsPath: 'files/Reports/2026/report.md',
    })
  })

  it.each(['', '///', 'Reports/../report.md', 'Reports\\2026\\report.md'])(
    'rejects invalid relative write path %j',
    (path) => {
      expect(() => parseRelativeWorkspaceFileCreatePath(path)).toThrow()
    }
  )

  it('rejects folder depth and complete encoded path byte overflows', () => {
    const excessiveDepth = [
      ...Array.from({ length: MAX_FOLDER_PATH_SEGMENTS + 1 }, (_, index) => `folder-${index}`),
      'report.md',
    ].join('/')
    expect(() => parseRelativeWorkspaceFileCreatePath(excessiveDepth)).toThrow(
      `Folder paths cannot exceed ${MAX_FOLDER_PATH_SEGMENTS} segments`
    )

    expect(() =>
      parseRelativeWorkspaceFileCreatePath(`${'a'.repeat(MAX_WORKSPACE_FILE_PATH_BYTES)}.md`)
    ).toThrow(`Workspace file paths cannot exceed ${MAX_WORKSPACE_FILE_PATH_BYTES} bytes`)
  })

  it('parses canonical encoded VFS paths and builds paths from persisted records', () => {
    expect(parseWorkspaceFileCreatePath('files/Reports%20%26%20Plans/2026/report.md')).toEqual({
      folderSegments: ['Reports & Plans', '2026'],
      fileName: 'report.md',
      vfsPath: 'files/Reports%20%26%20Plans/2026/report.md',
    })
    expect(
      workspaceFileVfsPath({ folderPath: 'Reports & Plans/2026', name: 'report (1).md' })
    ).toBe('files/Reports%20%26%20Plans/2026/report%20(1).md')
  })
})
