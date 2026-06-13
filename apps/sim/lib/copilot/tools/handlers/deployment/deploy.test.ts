/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/lib/copilot/request/types'

const {
  ensureWorkflowAccessMock,
  getDeployedWorkflowInputFormatMock,
  generateParameterSchemaMock,
  loadWorkflowFromNormalizedTablesMock,
  saveWorkflowToNormalizedTablesMock,
  notifyWorkflowUpdatedMock,
  performCreateWorkflowMcpToolMock,
  performUpdateWorkflowMcpToolMock,
} = vi.hoisted(() => ({
  ensureWorkflowAccessMock: vi.fn(),
  getDeployedWorkflowInputFormatMock: vi.fn(),
  generateParameterSchemaMock: vi.fn(),
  loadWorkflowFromNormalizedTablesMock: vi.fn(),
  saveWorkflowToNormalizedTablesMock: vi.fn(),
  notifyWorkflowUpdatedMock: vi.fn(),
  performCreateWorkflowMcpToolMock: vi.fn(),
  performUpdateWorkflowMcpToolMock: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  chat: {},
  workflow: {},
  workflowMcpServer: {},
  workflowMcpTool: {},
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateWorkflowMcpTool: performCreateWorkflowMcpToolMock,
  performUpdateWorkflowMcpTool: performUpdateWorkflowMcpToolMock,
  performDeleteWorkflowMcpTool: vi.fn(),
}))

vi.mock('@/lib/mcp/workflow-mcp-sync', () => ({
  getDeployedWorkflowInputFormat: getDeployedWorkflowInputFormatMock,
}))

vi.mock('@/lib/mcp/workflow-tool-schema', () => ({
  generateParameterSchema: generateParameterSchemaMock,
  sanitizeToolName: (value: string) => value,
}))

vi.mock('@/lib/workflows/notify-socket', () => ({
  notifyWorkflowUpdated: notifyWorkflowUpdatedMock,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performChatDeploy: vi.fn(),
  performChatUndeploy: vi.fn(),
  performFullDeploy: vi.fn(),
  performFullUndeploy: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: loadWorkflowFromNormalizedTablesMock,
  saveWorkflowToNormalizedTables: saveWorkflowToNormalizedTablesMock,
}))

vi.mock('@/lib/workflows/triggers/input-definition-triggers', () => ({
  isInputDefinitionTrigger: (type: string | undefined) => type === 'starter',
}))

vi.mock('@/app/api/chat/utils', () => ({
  checkChatAccess: vi.fn(),
  checkWorkflowAccessForChatCreation: vi.fn(),
}))

vi.mock('../access', () => ({
  ensureWorkflowAccess: ensureWorkflowAccessMock,
}))

import { db } from '@sim/db'
import { executeDeployMcp } from './deploy'

const CONTEXT = { userId: 'user-1', workflowId: 'wf-1' } as ExecutionContext

/** Single-row select chain ending in `.limit()`, matching the handler's queries. */
function selectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(result)),
  }
  return chain
}

function updateChain() {
  const chain = {
    set: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve()),
  }
  return chain
}

/** Draft state with a single start block exposing one `query` input field. */
function draftWithQueryField(description?: string) {
  return {
    blocks: {
      start: {
        id: 'start',
        type: 'starter',
        subBlocks: {
          inputFormat: {
            id: 'inputFormat',
            type: 'input-format',
            value: [
              { id: 'f1', name: 'query', type: 'string', ...(description ? { description } : {}) },
            ],
          },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
}

function startBlockInputFields(state: { blocks: Record<string, any> }) {
  return state.blocks.start.subBlocks.inputFormat.value as Array<Record<string, unknown>>
}

describe('executeDeployMcp parameter-description persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', name: 'tool', isDeployed: true },
    })
    // 1st select = server lookup, 2nd select = existing tool lookup (none).
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain([{ id: 'srv-1', name: 'My Server' }]) as never)
      .mockReturnValueOnce(selectChain([]) as never)
    vi.mocked(db.update).mockReturnValue(updateChain() as never)
    getDeployedWorkflowInputFormatMock.mockResolvedValue([{ name: 'query', type: 'string' }])
    generateParameterSchemaMock.mockReturnValue({ type: 'object', properties: {} })
    loadWorkflowFromNormalizedTablesMock.mockResolvedValue(draftWithQueryField())
    saveWorkflowToNormalizedTablesMock.mockResolvedValue({ success: true })
    performCreateWorkflowMcpToolMock.mockResolvedValue({
      success: true,
      tool: { id: 'tool-1', toolName: 'tool' },
    })
  })

  it('persists supplied descriptions onto the draft start block and notifies the socket', async () => {
    const result = await executeDeployMcp(
      {
        workflowId: 'wf-1',
        serverId: 'srv-1',
        parameterDescriptions: [{ name: 'query', description: 'Search text' }],
      },
      CONTEXT
    )

    expect(result.success).toBe(true)
    expect(saveWorkflowToNormalizedTablesMock).toHaveBeenCalledTimes(1)

    const [savedWorkflowId, savedState] = saveWorkflowToNormalizedTablesMock.mock.calls[0]
    expect(savedWorkflowId).toBe('wf-1')
    const fields = startBlockInputFields(savedState)
    // Description applied, every other field property preserved.
    expect(fields[0]).toMatchObject({
      id: 'f1',
      name: 'query',
      type: 'string',
      description: 'Search text',
    })
    expect(notifyWorkflowUpdatedMock).toHaveBeenCalledWith('wf-1')

    // The tool schema is still generated with the descriptions for immediate effect.
    expect(generateParameterSchemaMock).toHaveBeenCalledWith([{ name: 'query', type: 'string' }], {
      query: 'Search text',
    })
    expect(performCreateWorkflowMcpToolMock).toHaveBeenCalledWith(
      expect.objectContaining({ parameterSchema: { type: 'object', properties: {} } })
    )
  })

  it('does not touch the draft when no descriptions are supplied', async () => {
    const result = await executeDeployMcp({ workflowId: 'wf-1', serverId: 'srv-1' }, CONTEXT)

    expect(result.success).toBe(true)
    expect(loadWorkflowFromNormalizedTablesMock).not.toHaveBeenCalled()
    expect(saveWorkflowToNormalizedTablesMock).not.toHaveBeenCalled()
    expect(notifyWorkflowUpdatedMock).not.toHaveBeenCalled()
  })

  it('does not write when the supplied description already matches the start block', async () => {
    loadWorkflowFromNormalizedTablesMock.mockResolvedValue(draftWithQueryField('Search text'))

    const result = await executeDeployMcp(
      {
        workflowId: 'wf-1',
        serverId: 'srv-1',
        parameterDescriptions: [{ name: 'query', description: 'Search text' }],
      },
      CONTEXT
    )

    expect(result.success).toBe(true)
    expect(loadWorkflowFromNormalizedTablesMock).toHaveBeenCalledTimes(1)
    expect(saveWorkflowToNormalizedTablesMock).not.toHaveBeenCalled()
    expect(notifyWorkflowUpdatedMock).not.toHaveBeenCalled()
  })

  it('ignores descriptions for fields that are not in the start block', async () => {
    const result = await executeDeployMcp(
      {
        workflowId: 'wf-1',
        serverId: 'srv-1',
        parameterDescriptions: [{ name: 'nonexistent', description: 'orphan' }],
      },
      CONTEXT
    )

    expect(result.success).toBe(true)
    // Field doesn't exist → nothing changes → no write.
    expect(saveWorkflowToNormalizedTablesMock).not.toHaveBeenCalled()
    expect(notifyWorkflowUpdatedMock).not.toHaveBeenCalled()
  })
})
