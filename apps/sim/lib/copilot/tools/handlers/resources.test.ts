/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getWorkspaceFileMock } = vi.hoisted(() => ({
  getWorkspaceFileMock: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {},
}))

vi.mock('@sim/db/schema', () => ({}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: getWorkspaceFileMock,
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
        },
      ],
    })
  })
})
