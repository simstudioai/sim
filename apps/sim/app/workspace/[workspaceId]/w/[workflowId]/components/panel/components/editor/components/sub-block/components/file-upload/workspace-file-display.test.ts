/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  findSelectedWorkspaceFile,
  getWorkspaceFileDisplayLabel,
  workspaceFileMatchesSelection,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/file-upload/workspace-file-display'

const reportsFile = {
  id: 'file-reports',
  name: 'report.md',
  key: 'workspace/workspace-1/report-reports.md',
  path: '/api/files/serve/report-reports',
  folderPath: 'Reports/2026',
}

const archiveFile = {
  id: 'file-archive',
  name: 'report.md',
  key: 'workspace/workspace-1/report-archive.md',
  path: '/api/files/serve/report-archive',
  folderPath: 'Archive',
}

describe('workspace file picker display', () => {
  it('shows folder breadcrumbs while keeping root-level labels compact', () => {
    expect(getWorkspaceFileDisplayLabel(reportsFile)).toBe('Reports / 2026 / report.md')
    expect(getWorkspaceFileDisplayLabel({ name: 'root.md', folderPath: null })).toBe('root.md')
  })

  it('decodes escaped slashes in folder display paths', () => {
    expect(
      getWorkspaceFileDisplayLabel({
        name: 'contract.pdf',
        folderPath: 'Finance\\/Legal/2026',
      })
    ).toBe('Finance/Legal / 2026 / contract.pdf')
  })

  it('uses the persisted ID to disambiguate duplicate leaf names', () => {
    expect(
      findSelectedWorkspaceFile([reportsFile, archiveFile], {
        id: archiveFile.id,
        name: 'report.md',
      })
    ).toBe(archiveFile)
    expect(
      workspaceFileMatchesSelection(reportsFile, {
        id: archiveFile.id,
        name: 'report.md',
      })
    ).toBe(false)
  })

  it('retains name matching for legacy saved values without stable identifiers', () => {
    expect(
      findSelectedWorkspaceFile([reportsFile, archiveFile], {
        name: 'report.md',
      })
    ).toBe(reportsFile)
  })

  it('matches id-less values with folder metadata by their complete location', () => {
    expect(
      findSelectedWorkspaceFile([reportsFile, archiveFile], {
        name: 'report.md',
        folderPath: 'Archive',
      })
    ).toBe(archiveFile)
  })
})
