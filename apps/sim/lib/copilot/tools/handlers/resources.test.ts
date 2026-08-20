/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listAllWorkspaceFilesMock, readKnowledgeBaseMock, readWorkspaceFileMetadataMock } =
  vi.hoisted(() => ({
    listAllWorkspaceFilesMock: vi.fn(),
    readKnowledgeBaseMock: vi.fn(),
    readWorkspaceFileMetadataMock: vi.fn(),
  }))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  findWorkspaceFileRecord: (
    files: Array<{ id: string; name: string; folderPath: string | null }>
  ) => files[0] ?? null,
}))

vi.mock('@/lib/workspace-files/application/list-workspace-files', () => ({
  listAllWorkspaceFiles: {
    operation: { id: 'files.list' },
    execute: listAllWorkspaceFilesMock,
  },
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-metadata', () => ({
  readWorkspaceFileMetadata: {
    operation: { id: 'files.read_metadata' },
    execute: readWorkspaceFileMetadataMock,
  },
}))

vi.mock('@/lib/workflows/utils', () => ({
  getWorkflowById: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: vi.fn(),
}))

vi.mock('@/lib/table/views/service', () => ({
  getTableView: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  readKnowledgeBase: {
    operation: { id: 'knowledge.read' },
    execute: readKnowledgeBaseMock,
  },
}))

vi.mock('@/lib/copilot/application/execute-file-use-case', () => ({
  executeCopilotFileUseCase: (
    context: { userId: string; workspaceId: string; toolCallId: string },
    useCase: { execute: (args: unknown) => unknown },
    input: unknown
  ) =>
    useCase.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: context.userId,
        workspaceId: context.workspaceId,
        delegationId: context.toolCallId,
      },
      input,
    }),
}))

vi.mock('@/lib/copilot/application/execute-knowledge-use-case', () => ({
  executeCopilotKnowledgeUseCase: (
    context: { userId: string; workspaceId: string; toolCallId: string },
    useCase: { execute: (args: unknown) => unknown },
    input: unknown
  ) =>
    useCase.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: context.userId,
        workspaceId: context.workspaceId,
        delegationId: context.toolCallId,
      },
      input,
    }),
}))

vi.mock('@/lib/logs/service', () => ({
  getLogById: vi.fn(),
}))

import { getTableById } from '@/lib/table/service'
import { getTableView } from '@/lib/table/views/service'
import { executeOpenResource } from './resources'

describe('executeOpenResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens workspace files with canonical non-UUID file ids', async () => {
    readWorkspaceFileMetadataMock.mockResolvedValue({
      file: {
        id: 'wf_qL_cfff-FskMsXtOdm599',
        name: 'MAC_Brand_Guidelines_May_2021 (1).docx',
        folderPath: null,
      },
    })

    const result = await executeOpenResource(
      {
        resources: [{ type: 'file', id: 'wf_qL_cfff-FskMsXtOdm599' }],
      },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        toolCallId: 'tool-1',
        copilotToolExecution: true,
      }
    )

    expect(readWorkspaceFileMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          fileId: 'wf_qL_cfff-FskMsXtOdm599',
          assertedWorkspaceId: 'workspace-1',
        },
      })
    )
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
    listAllWorkspaceFilesMock.mockResolvedValue({
      files: [
        {
          id: 'wf_qL_cfff-FskMsXtOdm599',
          name: 'MAC_Brand_Guidelines_May_2021 (1).docx',
          folderPath: 'Docs',
        },
      ],
    })

    const result = await executeOpenResource(
      {
        resources: [{ type: 'file', path: 'files/Docs/MAC_Brand_Guidelines.docx' }],
      },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        toolCallId: 'tool-1',
        copilotToolExecution: true,
      }
    )

    expect(listAllWorkspaceFilesMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: { workspaceId: 'workspace-1', scope: 'active' } })
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

  it('opens a knowledge base through trusted application delegation', async () => {
    readKnowledgeBaseMock.mockResolvedValue({
      knowledgeBase: { id: 'kb-1', name: 'Product Docs', workspaceId: 'workspace-1' },
      folderPath: '/',
    })

    const result = await executeOpenResource(
      { resources: [{ type: 'knowledgebase', id: 'kb-1' }] },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        toolCallId: 'tool-1',
        copilotToolExecution: true,
      }
    )

    expect(readKnowledgeBaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({
          kind: 'delegated',
          subjectUserId: 'user-1',
          workspaceId: 'workspace-1',
          delegationId: 'tool-1',
        }),
        input: { knowledgeBaseId: 'kb-1', assertedWorkspaceId: 'workspace-1' },
      })
    )
    expect(result).toMatchObject({
      success: true,
      resources: [{ type: 'knowledgebase', id: 'kb-1', title: 'Product Docs' }],
    })
  })

  it('propagates knowledge application infrastructure failures', async () => {
    readKnowledgeBaseMock.mockRejectedValueOnce(new Error('knowledge database unavailable'))

    await expect(
      executeOpenResource(
        { resources: [{ type: 'knowledgebase', id: 'kb-1' }] },
        {
          userId: 'user-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          toolCallId: 'tool-1',
          copilotToolExecution: true,
        }
      )
    ).rejects.toThrow('knowledge database unavailable')
  })
})

describe('open_resource table views', () => {
  const executionContext = { userId: 'user-1', workspaceId: 'ws-1' } as never

  it('opens a table pinned to a saved view by id, stamping viewId and a pinned title', async () => {
    vi.mocked(getTableById).mockResolvedValue({
      id: 'tbl-1',
      name: 'Leads',
      workspaceId: 'ws-1',
      schema: { columns: [{ id: 'col_a', name: 'status', type: 'string' }] },
    } as never)
    vi.mocked(getTableView).mockResolvedValue({
      id: 'view-1',
      name: 'Overdue',
      isDefault: false,
      config: {},
    } as never)

    const result = await executeOpenResource(
      { resources: [{ type: 'table', id: 'tbl-1', view: 'view-1' }] },
      executionContext
    )

    expect(result.success).toBe(true)
    expect(result.resources?.[0]).toMatchObject({
      type: 'table',
      id: 'tbl-1',
      title: 'Leads — Overdue',
      viewId: 'view-1',
    })
  })

  it('rejects an unknown view id and points at views.json', async () => {
    vi.mocked(getTableById).mockResolvedValue({
      id: 'tbl-1',
      name: 'Leads',
      workspaceId: 'ws-1',
      schema: { columns: [] },
    } as never)
    vi.mocked(getTableView).mockResolvedValue(null as never)

    const missing = await executeOpenResource(
      { resources: [{ type: 'table', id: 'tbl-1', view: 'view-nope' }] },
      executionContext
    )
    expect(missing.success).toBe(false)
    expect((missing.output as { errors: string[] }).errors[0]).toContain('views.json')
  })
})
