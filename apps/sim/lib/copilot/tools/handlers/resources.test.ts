/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getTableByIdMock,
  getTableViewMock,
  getWorkspaceFileMock,
  resolveWorkspaceFileReferenceMock,
} = vi.hoisted(() => ({
  getTableByIdMock: vi.fn(),
  getTableViewMock: vi.fn(),
  getWorkspaceFileMock: vi.fn(),
  resolveWorkspaceFileReferenceMock: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: getWorkspaceFileMock,
  resolveWorkspaceFileReference: resolveWorkspaceFileReferenceMock,
}))

vi.mock('@/lib/workflows/utils', () => ({
  getWorkflowById: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: getTableByIdMock,
}))

vi.mock('@/lib/table/views/service', () => ({
  getTableView: getTableViewMock,
}))

vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseById: vi.fn(),
}))

vi.mock('@/lib/logs/service', () => ({
  getLogById: vi.fn(),
}))

import { executeOpenResource } from './resources'

describe('executeOpenResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens workspace files with canonical non-UUID file ids', async () => {
    getWorkspaceFileMock.mockResolvedValue({
      id: 'wf_qL_cfff-FskMsXtOdm599',
      name: 'MAC_Brand_Guidelines_May_2021 (1).docx',
      folderPath: null,
    })

    const result = await executeOpenResource(
      {
        resources: [{ type: 'file', id: 'wf_qL_cfff-FskMsXtOdm599' }],
      },
      { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'workspace-1' }
    )

    expect(getWorkspaceFileMock).toHaveBeenCalledWith('workspace-1', 'wf_qL_cfff-FskMsXtOdm599')
    expect(result).toMatchObject({
      success: true,
      output: { opened: 1, errors: [] },
      resources: [
        {
          type: 'file',
          id: 'wf_qL_cfff-FskMsXtOdm599',
          title: 'MAC_Brand_Guidelines_May_2021 (1).docx',
          path: 'files/MAC_Brand_Guidelines_May_2021%20(1).docx',
        },
      ],
    })
  })

  it('opens workspace files by canonical VFS path', async () => {
    resolveWorkspaceFileReferenceMock.mockResolvedValue({
      id: 'wf_qL_cfff-FskMsXtOdm599',
      name: 'MAC_Brand_Guidelines_May_2021 (1).docx',
      folderPath: 'Docs',
    })

    const result = await executeOpenResource(
      {
        resources: [{ type: 'file', path: 'files/Docs/MAC_Brand_Guidelines.docx' }],
      },
      { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'workspace-1' }
    )

    expect(resolveWorkspaceFileReferenceMock).toHaveBeenCalledWith(
      'workspace-1',
      'files/Docs/MAC_Brand_Guidelines.docx'
    )
    expect(result).toMatchObject({
      success: true,
      output: { opened: 1, errors: [] },
      resources: [
        {
          type: 'file',
          id: 'wf_qL_cfff-FskMsXtOdm599',
          title: 'MAC_Brand_Guidelines_May_2021 (1).docx',
          path: 'files/Docs/MAC_Brand_Guidelines_May_2021%20(1).docx',
        },
      ],
    })
  })

  it('opens a View as a durable resource backed by its source Table', async () => {
    getTableViewMock.mockResolvedValue({
      id: 'view_1',
      tableId: 'tbl_1',
      name: 'Qualified leads',
    })
    getTableByIdMock.mockResolvedValue({
      id: 'tbl_1',
      workspaceId: 'workspace-1',
      name: 'Leads',
    })

    const result = await executeOpenResource(
      { resources: [{ type: 'view', id: 'view_1' }] },
      { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'workspace-1' }
    )

    expect(result).toMatchObject({
      success: true,
      output: { opened: 1, errors: [] },
      resources: [{ type: 'view', id: 'tbl_1:view_1', title: 'Qualified leads' }],
    })
  })

  it('refuses a View whose source Table belongs to another workspace', async () => {
    getTableViewMock.mockResolvedValue({
      id: 'view_1',
      tableId: 'tbl_1',
      name: 'Unsafe View',
    })
    getTableByIdMock.mockResolvedValue({
      id: 'tbl_1',
      workspaceId: 'workspace-2',
      name: 'Private Table',
    })

    const result = await executeOpenResource(
      { resources: [{ type: 'view', id: 'view_1' }] },
      { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'workspace-1' }
    )

    expect(result).toMatchObject({
      success: false,
      output: { opened: 0, errors: ['View not found in the current workspace.'] },
      resources: [],
    })
  })
})
