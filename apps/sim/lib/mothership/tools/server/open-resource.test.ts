import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openResourceInputSchema } from '@/lib/api/contracts/mothership-resource-tools'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  workflow: vi.fn(),
  file: vi.fn(),
  table: vi.fn(),
  view: vi.fn(),
  knowledge: vi.fn(),
  log: vi.fn(),
}))
vi.mock('@/lib/workflows/application/read-workflow', async (original) => {
  const actual = await original<typeof import('@/lib/workflows/application/read-workflow')>()
  return {
    ...actual,
    readWorkflowMetadata: { ...actual.readWorkflowMetadata, execute: mocks.workflow },
  }
})
vi.mock('@/lib/workspace-files/application/read-workspace-file-metadata', async (original) => {
  const actual =
    await original<
      typeof import('@/lib/workspace-files/application/read-workspace-file-metadata')
    >()
  return {
    ...actual,
    readWorkspaceFileMetadata: { ...actual.readWorkspaceFileMetadata, execute: mocks.file },
  }
})
vi.mock('@/lib/table/application/tables', async (original) => {
  const actual = await original<typeof import('@/lib/table/application/tables')>()
  return {
    ...actual,
    readTableDefinitionUseCase: { ...actual.readTableDefinitionUseCase, execute: mocks.table },
  }
})
vi.mock('@/lib/table/application/views', async (original) => {
  const actual = await original<typeof import('@/lib/table/application/views')>()
  return {
    ...actual,
    readTableViewUseCase: { ...actual.readTableViewUseCase, execute: mocks.view },
  }
})
vi.mock('@/lib/knowledge/application/knowledge-bases', async (original) => {
  const actual = await original<typeof import('@/lib/knowledge/application/knowledge-bases')>()
  return { ...actual, readKnowledgeBase: { ...actual.readKnowledgeBase, execute: mocks.knowledge } }
})
vi.mock('@/lib/logs/application/read-log-detail', async (original) => {
  const actual = await original<typeof import('@/lib/logs/application/read-log-detail')>()
  return { ...actual, readLogDetailUseCase: { ...actual.readLogDetailUseCase, execute: mocks.log } }
})

import { openResourceServerTool } from '@/lib/mothership/tools/server/open-resource'

const context = {
  userId: 'actor',
  workspaceId: 'ws-a',
  requestMode: 'agent',
  toolCallId: 'call',
  copilotToolExecution: true,
}
const invoke = (raw: unknown, ctx = context) =>
  openResourceServerTool.execute(openResourceInputSchema.parse(raw), ctx)
beforeEach(() => {
  mocks.workflow.mockResolvedValue({ workflow: { name: 'Canonical workflow' } })
  mocks.file.mockResolvedValue({ file: { name: 'Canonical file' } })
  mocks.table.mockResolvedValue({ table: { name: 'Canonical table' } })
  mocks.view.mockResolvedValue({ view: { id: 'view' } })
  mocks.knowledge.mockResolvedValue({ knowledgeBase: { name: 'Canonical knowledge' } })
  mocks.log.mockResolvedValue({ detail: { executionId: 'run' } })
})
describe('resource opening authorization boundary', () => {
  it('calls each registered authorized read with actor scope and publishes canonical metadata', async () => {
    const result = await invoke({
      resources: [
        { type: 'workflow', id: 'flow' },
        { type: 'file', id: 'file' },
        { type: 'table', id: 'table', viewId: 'view' },
        { type: 'knowledgebase', id: 'kb' },
        { type: 'log', id: 'log' },
      ],
    })
    expect(result.resources.map((resource) => resource.title)).toEqual([
      'Canonical workflow',
      'Canonical file',
      'Canonical table',
      'Canonical knowledge',
      'Workflow run',
    ])
    expect(result.resources.every((resource) => resource.workspaceId === 'ws-a')).toBe(true)
    for (const read of Object.values(mocks))
      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: expect.objectContaining({ subjectUserId: 'actor', workspaceId: 'ws-a' }),
        })
      )
    expect(mocks.workflow.mock.calls[0][0].input).toEqual({
      workflowId: 'flow',
      assertedWorkspaceId: 'ws-a',
    })
    expect(mocks.view.mock.calls[0][0].input).toEqual({
      tableId: 'table',
      workspaceId: 'ws-a',
      viewId: 'view',
    })
    expect(result.resources.at(-1)?.executionId).toBe('run')
  })
  it('rejects forged ownership and untrusted contexts before domain reads', async () => {
    await expect(
      invoke({ workspaceId: 'foreign', resources: [{ type: 'workflow', id: 'flow' }] })
    ).rejects.toThrow('Workspace not found')
    await expect(
      invoke(
        { resources: [{ type: 'workflow', id: 'flow' }] },
        { ...context, copilotToolExecution: false }
      )
    ).rejects.toThrow()
    expect(mocks.workflow).not.toHaveBeenCalled()
  })
  it('publishes no batch result after an authorization failure', async () => {
    mocks.file.mockRejectedValue(new OrchestrationError('not_found', 'File not found'))
    await expect(
      invoke({
        resources: [
          { type: 'workflow', id: 'flow' },
          { type: 'file', id: 'file' },
        ],
      })
    ).rejects.toThrow('File not found')
  })
  it('rejects model-authored titles and mismatched view types', async () => {
    expect(() =>
      openResourceInputSchema.parse({
        resources: [{ type: 'workflow', id: 'flow', title: 'Forged' }],
      })
    ).toThrow()
    await expect(
      invoke({ resources: [{ type: 'workflow', id: 'flow', viewId: 'view' }] })
    ).rejects.toThrow('Saved views')
    expect(mocks.workflow).not.toHaveBeenCalled()
  })
})
