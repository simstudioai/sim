/** @vitest-environment node */
import {
  BLOCK_OPERATIONS,
  OPERATION_TARGETS,
  SUBBLOCK_OPERATIONS,
} from '@sim/realtime-protocol/constants'
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

describe('atomic tool reordering', () => {
  const block = {
    id: 'agent-1',
    type: 'agent',
    name: 'Agent',
    position: { x: 0, y: 0 },
    locked: false,
    subBlocks: {
      tools: {
        id: 'tools',
        type: 'tool-input',
        value: [{ type: 'jira', params: { projectId: 'project-1' } }],
      },
    },
    data: {},
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockTransaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<void>) => callback(transaction)
    )
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    mockSelectWhere.mockImplementation(() =>
      Object.assign(
        Promise.resolve([{ ...block, subBlocks: { tools: { value: [{ type: 'function' }] } } }]),
        {
          limit: async () => [
            { ...block, subBlocks: { tools: { value: [{ type: 'function' }] } } },
          ],
        }
      )
    )
  })

  it('persists a reordered tool array and its mode map in one write', async () => {
    const first = {
      type: 'jira',
      params: { projectId: 'project-1', manualProjectId: '<Start.project>' },
    }
    const second = {
      type: 'jira',
      params: { projectId: 'project-2', manualProjectId: '<Start.project>' },
    }
    const original = {
      ...block,
      subBlocks: { tools: { id: 'tools', type: 'tool-input', value: [first, second] } },
      data: { canonicalModes: { '1:projectId': 'advanced' } },
    }
    mockSelectWhere.mockResolvedValue([original])
    mockSet.mockReturnValue({
      where: () =>
        Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: block.id }] }),
    })
    const subBlocks = { tools: { id: 'tools', type: 'tool-input', value: [second, first] } }
    const canonicalModes = { '0:projectId': 'advanced' }
    await expect(
      persistWorkflowOperation('workflow-1', {
        operation: BLOCK_OPERATIONS.REPLACE_CANONICAL_MODES,
        target: OPERATION_TARGETS.BLOCK,
        timestamp: Date.now(),
        payload: { id: block.id, subBlocks, data: { canonicalModes } },
      })
    ).resolves.toBeUndefined()
    expect(mockSet).toHaveBeenLastCalledWith(
      expect.objectContaining({ subBlocks, data: { canonicalModes } })
    )
  })

  it('refuses an atomic tool update inside a locked container', async () => {
    mockSelectWhere.mockResolvedValue([
      { ...block, data: { parentId: 'container' } },
      { id: 'container', type: 'loop', locked: true, data: {} },
    ])
    await expect(
      persistWorkflowOperation('workflow-1', {
        operation: BLOCK_OPERATIONS.REPLACE_CANONICAL_MODES,
        target: OPERATION_TARGETS.BLOCK,
        timestamp: Date.now(),
        payload: { id: block.id, subBlocks: block.subBlocks, data: { canonicalModes: {} } },
      })
    ).rejects.toThrow('locked')
    expect(mockSet).toHaveBeenCalledTimes(1)
  })
})
