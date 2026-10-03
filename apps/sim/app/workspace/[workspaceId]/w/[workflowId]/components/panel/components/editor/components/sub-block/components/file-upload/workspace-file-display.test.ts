/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getWorkspaceFileDisplayLabel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/file-upload/workspace-file-display'

const reportsFile = {
  id: 'file-reports',
  name: 'report.md',
  key: 'workspace/workspace-1/report-reports.md',
  path: '/api/files/serve/report-reports',
  folderPath: 'Reports/2026',
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
})
