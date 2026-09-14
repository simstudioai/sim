/** @vitest-environment node */
import {
  BLOCK_OPERATIONS,
  OPERATION_TARGETS,
  SUBBLOCK_OPERATIONS,
} from '@sim/realtime-protocol/constants'
import { getToolInputIdentity } from '@sim/realtime-protocol/tool-input'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransaction, mockSelectWhere, mockSet } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockSelectWhere: vi.fn(),
  mockSet: vi.fn(),
}))

vi.mock('@sim/audit', () => ({ AuditAction: {}, AuditResourceType: {}, recordAudit: vi.fn() }))
vi.mock('@sim/db', () => ({
  instrumentPoolClient: vi.fn(),
  resolveDbUrl: vi.fn(() => 'postgres://localhost/test'),
  workflow: { id: 'workflow.id' },
  workflowBlocks: { id: 'block.id', workflowId: 'block.workflowId' },
  workflowEdges: {},
  workflowSubflows: {},
}))
vi.mock('@sim/db/timestamps', () => ({ withUtcTimestamps: (options: unknown) => options }))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@sim/platform-authz/workflow', () => ({
  getActiveWorkflowContext: vi.fn().mockResolvedValue({ id: 'workflow-1' }),
}))
vi.mock('@sim/workflow-persistence/load', () => ({
  loadWorkflowFromNormalizedTablesRaw: vi.fn(),
}))
vi.mock('@sim/workflow-persistence/subblocks', () => ({ mergeSubBlockValues: vi.fn() }))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  or: vi.fn(),
  sql: vi.fn(),
}))
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: () => ({ transaction: mockTransaction }) }))
vi.mock('postgres', () => ({ default: vi.fn() }))
vi.mock('@/env', () => ({
  env: { DATABASE_URL: 'postgres://localhost/test' },
}))

import { persistWorkflowOperation } from '@/database/operations'

const transaction = {
  select: () => ({ from: () => ({ where: mockSelectWhere }) }),
  update: () => ({ set: mockSet }),
  delete: vi.fn(),
  insert: vi.fn(),
}

describe('search replacement persistence', () => {
  const expected = [
    {
      type: 'function',
      params: { language: 'javascript', code: 'return 1' },
      usageControl: 'none',
    },
  ]
  const replacement = [{ ...expected[0], params: { ...expected[0].params, code: 'return 2' } }]

  beforeEach(() => {
    vi.clearAllMocks()
    mockTransaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<void>) => callback(transaction)
    )
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
  })

  function replaceTools(stored: unknown, expectedValue: unknown = expected) {
    mockSelectWhere.mockResolvedValue([
      {
        id: 'agent-1',
        type: 'agent',
        locked: false,
        data: {},
        subBlocks: { tools: { id: 'tools', type: 'tool-input', value: stored } },
      },
    ])
    return persistWorkflowOperation('workflow-1', {
      operation: SUBBLOCK_OPERATIONS.BATCH_UPDATE,
      target: OPERATION_TARGETS.SUBBLOCK,
      timestamp: Date.now(),
      payload: {
        updates: [{ blockId: 'agent-1', subblockId: 'tools', value: replacement, expectedValue }],
      },
    })
  }

  it('accepts equivalent nested tool objects after JSONB changes their key order', async () => {
    const stored = [
      {
        usageControl: 'none',
        params: { code: 'return 1', language: 'javascript' },
        type: 'function',
      },
    ]

    await expect(replaceTools(stored)).resolves.toEqual({ applied: true })
    expect(mockSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        subBlocks: { tools: { id: 'tools', type: 'tool-input', value: replacement } },
      })
    )
  })

  it('still rejects a tool parameter changed by another editor', async () => {
    await expect(
      replaceTools([{ ...expected[0], params: { ...expected[0].params, code: 'return 3' } }])
    ).rejects.toThrow('changed since replacement was planned')
    expect(mockSet).toHaveBeenCalledTimes(1)
  })

  it('still rejects reordered tool arrays', async () => {
    const another = { ...expected[0], params: { ...expected[0].params, code: 'return 3' } }
    await expect(replaceTools([another, expected[0]], [expected[0], another])).rejects.toThrow(
      'changed since replacement was planned'
    )
    expect(mockSet).toHaveBeenCalledTimes(1)
  })
})

describe('subblock update with canonical modes persistence', () => {
  const tools = [{ type: 'jira', params: { manualProjectId: '{{PROJECT}}' } }]
  const canonicalModes = { '0:projectId': 'advanced' as const, model: 'basic' as const }

  beforeEach(() => {
    vi.clearAllMocks()
    mockTransaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<void>) => callback(transaction)
    )
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
  })

  function updateTools(block: Record<string, unknown>) {
    mockSelectWhere.mockResolvedValue([
      {
        id: 'agent-1',
        locked: false,
        data: { width: 350, canonicalModes: { '1:projectId': 'advanced' } },
        subBlocks: { tools: { id: 'tools', type: 'tool-input', value: [] } },
        ...block,
      },
    ])
    return persistWorkflowOperation('workflow-1', {
      operation: SUBBLOCK_OPERATIONS.UPDATE_WITH_CANONICAL_MODES,
      target: OPERATION_TARGETS.SUBBLOCK,
      timestamp: Date.now(),
      payload: { blockId: 'agent-1', subblockId: 'tools', value: tools, canonicalModes },
    })
  }

  it('writes the subblock value and replaces canonical modes in one block update', async () => {
    await expect(updateTools({})).resolves.toEqual({ applied: true })

    expect(mockSet).toHaveBeenCalledTimes(2)
    expect(mockSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        subBlocks: { tools: { id: 'tools', type: 'tool-input', value: tools } },
        data: { width: 350, canonicalModes },
      })
    )
  })

  it('rejects a locked block without writing either field', async () => {
    await expect(updateTools({ locked: true })).rejects.toThrow('is locked')
    expect(mockSet).toHaveBeenCalledTimes(1)
  })
})

describe('tool-scoped canonical mode persistence', () => {
  const jira = { type: 'jira', operation: 'read-bulk', params: { manualProjectId: 'MAN' } }
  const wikipedia = { type: 'wikipedia', operation: 'wikipedia_search', params: { query: 'Sim' } }
  const mockReturning = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockTransaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<void>) => callback(transaction)
    )
    mockReturning.mockResolvedValue([{ id: 'agent-1' }])
    mockSet.mockReturnValue({
      where: vi.fn(() => Object.assign(Promise.resolve(undefined), { returning: mockReturning })),
    })
  })

  function toggle(storedTools: unknown[], payload: Record<string, unknown>) {
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([
        {
          data: { canonicalModes: { '0:projectId': 'basic' } },
          subBlocks: { tools: { id: 'tools', type: 'tool-input', value: storedTools } },
        },
      ]),
    })
    return persistWorkflowOperation('workflow-1', {
      operation: BLOCK_OPERATIONS.UPDATE_CANONICAL_MODE,
      target: OPERATION_TARGETS.BLOCK,
      timestamp: Date.now(),
      payload: { id: 'agent-1', canonicalMode: 'advanced', ...payload },
    })
  }

  function toolRef(toolIndex: number, tool: unknown) {
    return { subblockId: 'tools', toolIndex, identity: getToolInputIdentity(tool) ?? {} }
  }

  it('applies a mode while its tool still holds the toggled position', async () => {
    await expect(
      toggle([wikipedia, jira], {
        canonicalId: '1:agentToolUsageControl',
        toolRef: toolRef(1, jira),
      })
    ).resolves.toEqual({ applied: true })

    expect(mockSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          canonicalModes: { '0:projectId': 'basic', '1:agentToolUsageControl': 'advanced' },
        },
      })
    )
  })

  it('refuses a mode whose tool another editor moved first', async () => {
    await expect(
      toggle([jira, wikipedia], {
        canonicalId: '1:agentToolUsageControl',
        toolRef: toolRef(1, jira),
      })
    ).resolves.toEqual({ applied: false })

    expect(mockSet).toHaveBeenCalledTimes(1)
  })

  it('refuses a mode whose tool another editor removed first', async () => {
    await expect(
      toggle([wikipedia], { canonicalId: '1:agentToolUsageControl', toolRef: toolRef(1, jira) })
    ).resolves.toEqual({ applied: false })

    expect(mockSet).toHaveBeenCalledTimes(1)
  })

  it('refuses a key that does not match the referenced position', async () => {
    await expect(
      toggle([wikipedia, jira], {
        canonicalId: '0:agentToolUsageControl',
        toolRef: toolRef(1, jira),
      })
    ).resolves.toEqual({ applied: false })
  })

  it('applies a mode sent without a tool reference as before', async () => {
    await expect(toggle([], { canonicalId: 'files' })).resolves.toEqual({ applied: true })

    expect(mockSet).toHaveBeenCalledTimes(2)
  })
})
