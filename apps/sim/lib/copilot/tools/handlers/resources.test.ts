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
