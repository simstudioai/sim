/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAnd,
  mockDelete,
  mockEq,
  mockExecute,
  mockInsert,
  mockOnConflictDoNothing,
  mockTransaction,
  mockTxDelete,
  mockTxInsert,
  mockTxSelect,
  mockTxSelectDistinct,
  mockTxSelectFrom,
  mockTxSelectLimit,
  mockTxSelectWhere,
  mockTxValues,
  mockValues,
  mockWhere,
  mockTxWhere,
} = vi.hoisted(() => {
  const mockOnConflictDoNothing = vi.fn(async () => undefined)
  const mockValues = vi.fn(() => ({ onConflictDoNothing: mockOnConflictDoNothing }))
  const mockInsert = vi.fn(() => ({ values: mockValues }))
  const mockWhere = vi.fn(async () => undefined)
  const mockDelete = vi.fn(() => ({ where: mockWhere }))

  const mockTxValues = vi.fn(() => ({ onConflictDoNothing: mockOnConflictDoNothing }))
  const mockTxInsert = vi.fn(() => ({ values: mockTxValues }))
  const mockTxWhere = vi.fn(async () => undefined)
  const mockTxDelete = vi.fn(() => ({ where: mockTxWhere }))
  const mockTxSelectLimit = vi.fn(async () => [])
  const mockTxSelectWhere = vi.fn(() => ({ limit: mockTxSelectLimit }))
  const mockTxSelectFrom = vi.fn(() => ({ where: mockTxSelectWhere }))
  const mockTxSelect = vi.fn(() => ({ from: mockTxSelectFrom }))
  const mockTxSelectDistinct = vi.fn(() => ({ from: mockTxSelectFrom }))

  return {
    mockAnd: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
    mockDelete,
    mockEq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
    mockExecute: vi.fn(async () => [{ count: 0 }]),
    mockInsert,
    mockOnConflictDoNothing,
    mockTransaction: vi.fn(async (callback) =>
      callback({
        delete: mockTxDelete,
        insert: mockTxInsert,
        select: mockTxSelect,
        selectDistinct: mockTxSelectDistinct,
      })
    ),
    mockTxDelete,
    mockTxInsert,
    mockTxSelect,
    mockTxSelectDistinct,
    mockTxSelectFrom,
    mockTxSelectLimit,
    mockTxSelectWhere,
    mockTxValues,
    mockValues,
    mockWhere,
    mockTxWhere,
  }
})

vi.mock('@sim/db', () => ({
  db: {
    delete: mockDelete,
    execute: mockExecute,
    insert: mockInsert,
    transaction: mockTransaction,
  },
}))

vi.mock('@sim/db/schema', () => ({
  executionLargeValueDependencies: {
    childKey: 'executionLargeValueDependencies.childKey',
    parentKey: 'executionLargeValueDependencies.parentKey',
    workspaceId: 'executionLargeValueDependencies.workspaceId',
  },
  executionLargeValueReferences: {
    executionId: 'executionLargeValueReferences.executionId',
    key: 'executionLargeValueReferences.key',
    source: 'executionLargeValueReferences.source',
    workspaceId: 'executionLargeValueReferences.workspaceId',
  },
  executionLargeValues: {
    key: 'executionLargeValues.key',
    ownerExecutionId: 'executionLargeValues.ownerExecutionId',
  },
  workflowExecutionLogs: {
    executionId: 'workflowExecutionLogs.executionId',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    warn: vi.fn(),
  })),
}))

vi.mock('drizzle-orm', () => ({
  and: mockAnd,
  eq: mockEq,
  inArray: vi.fn((...args: unknown[]) => ({ op: 'inArray', args })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}))

import {
  MAX_LARGE_VALUE_REFERENCES_PER_SCOPE,
  pruneLargeValueMetadata,
  registerLargeValueOwner,
  replaceLargeValueReferences,
} from '@/lib/execution/payloads/large-value-metadata'

function largeValueKey(id: string, executionId = 'source-execution'): string {
  return `execution/workspace-1/workflow-1/${executionId}/large-value-lv_${id}.json`
}

describe('large value metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers valid large value owner metadata', async () => {
    const registered = await registerLargeValueOwner({
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_abcdefghijkl.json',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      size: 123.4,
    })

    expect(registered).toBe(true)
    expect(mockTxInsert).toHaveBeenCalledOnce()
    expect(mockTxValues).toHaveBeenCalledWith({
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_abcdefghijkl.json',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      ownerExecutionId: 'execution-1',
      size: 124,
    })
    expect(mockOnConflictDoNothing).toHaveBeenCalledOnce()
  })

  it('skips malformed owner keys', async () => {
    const registered = await registerLargeValueOwner({
      key: 'execution/workspace-1/workflow-1/other-execution/large-value-lv_abcdefghijkl.json',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      size: 123,
    })

    expect(registered).toBe(false)
    expect(mockTxInsert).not.toHaveBeenCalled()
  })

  it('records dependency closure for nested large value refs', async () => {
    const directKey = largeValueKey('abcdefghijkl')
    const transitiveKey = largeValueKey('mnopqrstuvwx', 'root-execution')
    mockTxSelectLimit.mockResolvedValueOnce([{ childKey: transitiveKey }])

    const registered = await registerLargeValueOwner(
      {
        key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_zyxwvutsrqpo.json',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        size: 123,
      },
      [directKey]
    )

    expect(registered).toBe(true)
    expect(mockTxSelectDistinct).toHaveBeenCalledOnce()
    expect(mockTxValues).toHaveBeenLastCalledWith([
      {
        parentKey: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_zyxwvutsrqpo.json',
        childKey: directKey,
        workspaceId: 'workspace-1',
      },
      {
        parentKey: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_zyxwvutsrqpo.json',
        childKey: transitiveKey,
        workspaceId: 'workspace-1',
      },
    ])
  })

  it('chunks dependency writes instead of emitting one oversized VALUES statement', async () => {
    const keys = Array.from({ length: 501 }, (_, index) =>
      largeValueKey(`a${index.toString(36).padStart(11, '0')}`)
    )

    await registerLargeValueOwner(
      {
        key: largeValueKey('zyxwvutsrqpo', 'execution-1'),
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        size: 123,
      },
      keys
    )

    expect(mockTxValues).toHaveBeenCalledTimes(3)
    expect(mockTxValues.mock.calls[1]?.[0]).toHaveLength(500)
    expect(mockTxValues.mock.calls[2]?.[0]).toHaveLength(1)
  })

  it('rejects reference sets over the metadata cardinality limit', async () => {
    const keys = Array.from({ length: MAX_LARGE_VALUE_REFERENCES_PER_SCOPE + 1 }, (_, index) =>
      largeValueKey(`b${index.toString(36).padStart(11, '0')}`)
    )

    await expect(
      registerLargeValueOwner(
        {
          key: largeValueKey('zyxwvutsrqpo', 'execution-1'),
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          size: 123,
        },
        keys
      )
    ).rejects.toThrow('exceeding the limit')
  })

  it('limits dependency closure reads to the remaining reference budget', async () => {
    const directKey = largeValueKey('a00000000000')
    mockTxSelectLimit.mockResolvedValueOnce(
      Array.from({ length: MAX_LARGE_VALUE_REFERENCES_PER_SCOPE }, (_, index) => ({
        childKey: largeValueKey(`c${index.toString(36).padStart(11, '0')}`),
      }))
    )

    await expect(
      registerLargeValueOwner(
        {
          key: largeValueKey('zyxwvutsrqpo', 'execution-1'),
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          size: 123,
        },
        [directKey]
      )
    ).rejects.toThrow('Large value dependency closure exceeds the limit')

    expect(mockTxSelectLimit).toHaveBeenCalledWith(MAX_LARGE_VALUE_REFERENCES_PER_SCOPE)
  })

  it('replaces an execution reference set with same-workspace unique keys', async () => {
    const matchingKey = largeValueKey('abcdefghijkl')
    const otherWorkspaceKey =
      'execution/workspace-2/workflow-1/source-execution/large-value-lv_abcdefghijkl.json'

    await replaceLargeValueReferences(
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-2',
        source: 'execution_log',
      },
      {
        a: {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_abcdefghijkl',
          kind: 'json',
          size: 123,
          key: matchingKey,
        },
        duplicate: {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_abcdefghijkl',
          kind: 'json',
          size: 123,
          key: matchingKey,
        },
        ignored: {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_abcdefghijkl',
          kind: 'json',
          size: 123,
          key: otherWorkspaceKey,
        },
      }
    )

    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockTxDelete).toHaveBeenCalledOnce()
    expect(mockEq).toHaveBeenCalledWith('executionLargeValueReferences.source', 'execution_log')
    expect(mockTxValues).toHaveBeenCalledWith([
      {
        key: matchingKey,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-2',
        source: 'execution_log',
      },
    ])
  })

  it('prunes large value metadata in bounded batches', async () => {
    mockExecute
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([{ count: 4 }])

    await expect(
      pruneLargeValueMetadata({
        workspaceIds: ['workspace-1'],
        tombstonesDeletedBefore: new Date('2026-01-01T00:00:00Z'),
        batchSize: 10,
        maxRowsPerTable: 100,
      })
    ).resolves.toEqual({
      referencesDeleted: 2,
      dependenciesDeleted: 3,
      tombstonesDeleted: 4,
    })
  })
})
