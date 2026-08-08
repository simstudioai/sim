/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getWorkspaceFileMock, resolveWorkspaceFileReferenceMock } = vi.hoisted(() => ({
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
  getTableById: vi.fn(),
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

  it('opens workflow alias file paths through workspace file reference resolution', async () => {
    resolveWorkspaceFileReferenceMock.mockResolvedValue({
      id: 'wf_plan_file',
      name: 'implementation.md',
      folderPath: 'system/workflows/My Workflow/.plans',
    })

    const result = await executeOpenResource(
      {
        resources: [{ type: 'file', path: 'workflows/My%20Workflow/.plans/implementation.md' }],
      },
      { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'workspace-1' }
    )

    expect(resolveWorkspaceFileReferenceMock).toHaveBeenCalledWith(
      'workspace-1',
      'workflows/My%20Workflow/.plans/implementation.md'
    )
    expect(result).toMatchObject({
      success: true,
      resources: [
        {
          type: 'file',
          id: 'wf_plan_file',
          title: 'implementation.md',
          path: 'files/system/workflows/My%20Workflow/.plans/implementation.md',
        },
      ],
    })
  })

  it('opens root plan alias file paths through workspace file reference resolution', async () => {
    resolveWorkspaceFileReferenceMock.mockResolvedValue({
      id: 'wf_root_plan',
      name: 'root.md',
      folderPath: 'system/.plans',
    })

    const result = await executeOpenResource(
      {
        resources: [{ type: 'file', path: '.plans/root.md' }],
      },
      { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'workspace-1' }
    )

    expect(resolveWorkspaceFileReferenceMock).toHaveBeenCalledWith('workspace-1', '.plans/root.md')
    expect(result).toMatchObject({
      success: true,
      resources: [
        {
          type: 'file',
          id: 'wf_root_plan',
          title: 'root.md',
          path: 'files/system/.plans/root.md',
        },
      ],
    })
  })
})
