/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetTableById, mockListTables, mockQueryRows, mockIsFeatureEnabled } = vi.hoisted(
  () => ({
    mockGetTableById: vi.fn(),
    mockListTables: vi.fn(),
    mockQueryRows: vi.fn(),
    mockIsFeatureEnabled: vi.fn(),
  })
)

vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetTableById,
  listTables: mockListTables,
}))

vi.mock('@/lib/table/rows/service', () => ({
  queryRows: mockQueryRows,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

vi.mock('@/tools', () => ({
  executeTool: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: vi.fn(),
  findWorkspaceFileRecord: vi.fn(),
  getSandboxWorkspaceFilePath: vi.fn(),
  listWorkspaceFiles: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  listWorkspaceFileFolders: vi.fn(),
}))

vi.mock('@/lib/copilot/vfs/path-utils', () => ({
  decodeVfsPathSegments: vi.fn(),
  encodeVfsPathSegments: vi.fn(),
}))

vi.mock('@/lib/copilot/vfs/workflow-alias-resolver', () => ({
  resolveWorkflowAliasForWorkspace: vi.fn(),
}))

vi.mock('@/lib/copilot/vfs/workflow-aliases', () => ({
  isPlanAliasPath: vi.fn().mockReturnValue(false),
  workflowAliasSandboxPath: vi.fn(),
}))

import { resolveInputFiles } from '@/lib/copilot/tools/handlers/function-execute'

describe('resolveInputFiles — table mount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFeatureEnabled.mockResolvedValue(false)
  })

  it('mounts a CSV with display-name headers and id-keyed values, never column ids', async () => {
    mockGetTableById.mockResolvedValue({
      id: 'tbl_123',
      workspaceId: 'ws_1',
      name: 'people',
      schema: {
        columns: [
          { id: 'col_name', name: 'name', type: 'text' },
          { id: 'col_company', name: 'company', type: 'text' },
        ],
      },
    })
    mockQueryRows.mockResolvedValue({
      rows: [
        { id: 'r1', data: { col_name: 'Ada', col_company: 'Analytical Engine' } },
        { id: 'r2', data: { col_name: 'Grace', col_company: 'Navy, Inc' } },
      ],
    })

    const files = await resolveInputFiles('ws_1', undefined, ['tbl_123'])

    expect(files).toHaveLength(1)
    const csv = files[0].content
    const lines = csv.split('\n')

    expect(lines[0]).toBe('name,company')
    expect(lines[1]).toBe('Ada,Analytical Engine')
    // Value containing a comma is quoted.
    expect(lines[2]).toBe('Grace,"Navy, Inc"')
    // No stable column id leaks into the mounted file.
    expect(csv).not.toContain('col_name')
    expect(csv).not.toContain('col_company')
    expect(files[0].path).toBe('/home/user/tables/tbl_123.csv')
  })

  it('reads values by column id for legacy name-keyed rows too', async () => {
    mockGetTableById.mockResolvedValue({
      id: 'tbl_legacy',
      workspaceId: 'ws_1',
      name: 'legacy',
      schema: {
        // Legacy column with no id: getColumnId falls back to name.
        columns: [{ name: 'email', type: 'text' }],
      },
    })
    mockQueryRows.mockResolvedValue({
      rows: [{ id: 'r1', data: { email: 'a@b.com' } }],
    })

    const files = await resolveInputFiles('ws_1', undefined, ['tbl_legacy'])

    expect(files[0].content).toBe('email\na@b.com')
  })
})
