import { OPERATION_TARGETS, SUBBLOCK_OPERATIONS } from '@sim/realtime-protocol/constants'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { databaseMock, drizzleOrmMock } from '@sim/testing/mocks/database.mock'
import { loggerMock } from '@sim/testing/mocks/logger.mock'
import { workflowAuthzMock, workflowAuthzMockFns } from '@sim/testing/mocks/workflow-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransaction, mockSelectWhere, mockSet } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockSelectWhere: vi.fn(),
  mockSet: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/db', () => databaseMock)
vi.mock('@sim/db/timestamps', () => ({ withUtcTimestamps: (options: unknown) => options }))
vi.mock('@sim/logger', () => loggerMock)
vi.mock('@sim/platform-authz/workflow', () => workflowAuthzMock)
vi.mock('@sim/workflow-persistence/load', () => ({
  loadWorkflowFromNormalizedTablesRaw: vi.fn(),
}))
vi.mock('@sim/workflow-persistence/subblocks', () => ({ mergeSubBlockValues: vi.fn() }))
vi.mock('drizzle-orm', () => drizzleOrmMock)
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: () => ({ transaction: mockTransaction }) }))
vi.mock('postgres', () => ({ default: vi.fn() }))
vi.mock('@/env', () => ({
  env: { DATABASE_URL: 'postgres://localhost/test' },
}))

import { persistWorkflowOperation } from '@/database/operations'

workflowAuthzMockFns.mockGetActiveWorkflowContext.mockResolvedValue({ id: 'workflow-1' })

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

    await expect(replaceTools(stored)).resolves.toBeUndefined()
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
    await expect(updateTools({})).resolves.toBeUndefined()

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
