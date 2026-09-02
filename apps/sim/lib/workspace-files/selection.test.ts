/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { findSelectedWorkspaceFile } from '@/lib/workspace-files/selection'

const files = [
  {
    id: 'wf_reports',
    key: 'workspace/ws/reports',
    path: '/api/files/serve/wf_reports',
    name: 'report.md',
    folderPath: 'Reports',
  },
  {
    id: 'wf_archive',
    key: 'workspace/ws/archive',
    path: '/api/files/serve/wf_archive',
    name: 'report.md',
    folderPath: 'Archive',
  },
]

describe('findSelectedWorkspaceFile', () => {
  it('uses the canonical id before every legacy field', () => {
    expect(
      findSelectedWorkspaceFile(
        { id: 'wf_archive', key: files[0].key, path: files[0].path, name: 'report.md' },
        files
      )?.id
    ).toBe('wf_archive')
  })

  it('resolves legacy key and path values', () => {
    expect(findSelectedWorkspaceFile({ key: files[0].key, name: 'report.md' }, files)?.id).toBe(
      'wf_reports'
    )
    expect(findSelectedWorkspaceFile({ path: files[1].path, name: 'report.md' }, files)?.id).toBe(
      'wf_archive'
    )
    expect(
      findSelectedWorkspaceFile(
        { path: `https://files.example/${files[1].key}`, name: 'report.md' },
        files
      )?.id
    ).toBe('wf_archive')
  })

  it('does not guess when a legacy name is ambiguous', () => {
    expect(findSelectedWorkspaceFile({ name: 'report.md' }, files)).toBeUndefined()
  })

  it('uses a stored folder to disambiguate the oldest name-only shape', () => {
    expect(findSelectedWorkspaceFile({ name: 'report.md', folderPath: 'Archive' }, files)?.id).toBe(
      'wf_archive'
    )
  })
})
