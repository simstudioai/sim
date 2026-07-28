/**
 * @vitest-environment node
 */

import { executionLargeValueDependencies, executionLargeValueReferences } from '@sim/db/schema'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { eq, notInArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addLargeValueReference,
  MAX_LARGE_VALUE_REFERENCES_PER_SCOPE,
  pruneLargeValueMetadata,
  registerLargeValueOwner,
  replaceLargeValueReferences,
} from '@/lib/execution/payloads/large-value-metadata'

function largeValueKey(id: string, executionId = 'source-execution'): string {
  return `execution/workspace-1/workflow-1/${executionId}/large-value-lv_${id}.json`
}

afterAll(resetDbChainMock)

describe('large value metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.execute.mockResolvedValue([{ count: 0 }])
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
    expect(dbChainMockFns.insert).toHaveBeenCalledOnce()
    expect(dbChainMockFns.values).toHaveBeenCalledWith({
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_abcdefghijkl.json',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      ownerExecutionId: 'execution-1',
      size: 124,
    })
    expect(dbChainMockFns.onConflictDoNothing).toHaveBeenCalledOnce()
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
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('records dependency closure for nested large value refs', async () => {
    const directKey = largeValueKey('abcdefghijkl')
    const transitiveKey = largeValueKey('mnopqrstuvwx', 'root-execution')
    const deepTransitiveKey = largeValueKey('deepqrstuvwx', 'deep-execution')
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ childKey: transitiveKey }])
      .mockResolvedValueOnce([{ childKey: deepTransitiveKey }])
      .mockResolvedValueOnce([])

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
    expect(dbChainMockFns.selectDistinct).toHaveBeenCalledTimes(3)
    expect(dbChainMockFns.values).toHaveBeenLastCalledWith([
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
      {
        parentKey: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_zyxwvutsrqpo.json',
        childKey: deepTransitiveKey,
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

    expect(dbChainMockFns.values).toHaveBeenCalledTimes(3)
    expect(dbChainMockFns.values.mock.calls[1]?.[0]).toHaveLength(500)
    expect(dbChainMockFns.values.mock.calls[2]?.[0]).toHaveLength(1)
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
    dbChainMockFns.limit.mockResolvedValueOnce(
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

    expect(dbChainMockFns.limit).toHaveBeenCalledWith(MAX_LARGE_VALUE_REFERENCES_PER_SCOPE)
  })

  it('filters known dependency children before applying the remaining reference budget', async () => {
    const directKeys = Array.from({ length: MAX_LARGE_VALUE_REFERENCES_PER_SCOPE }, (_, index) =>
      largeValueKey(`e${index.toString(36).padStart(11, '0')}`)
    )
    const knownChildKey = directKeys[1]
    const unseenChildKey = largeValueKey('unseenchild1', 'source-execution')
    dbChainMockFns.limit.mockImplementationOnce(async () => {
      const filtersKnownChildren = vi
        .mocked(notInArray)
        .mock.calls.some(
          ([field, values]) =>
            field === executionLargeValueDependencies.childKey &&
            Array.isArray(values) &&
            values.includes(knownChildKey)
        )
      return [{ childKey: filtersKnownChildren ? unseenChildKey : knownChildKey }]
    })

    await expect(
      registerLargeValueOwner(
        {
          key: largeValueKey('zyxwvutsrqpo', 'execution-1'),
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          size: 123,
        },
        directKeys
      )
    ).rejects.toThrow('Large value dependency closure exceeds the limit')

    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
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

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.delete).toHaveBeenCalledOnce()
    expect(eq).toHaveBeenCalledWith(executionLargeValueReferences.source, 'execution_log')
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      {
        key: matchingKey,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-2',
        source: 'execution_log',
      },
    ])
  })

  it('adds a materialized reference only when the scope is below the reference cap', async () => {
    const key = largeValueKey('abcdefghijkl')

    await addLargeValueReference(
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-2',
        source: 'execution_log',
      },
      key
    )

    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(MAX_LARGE_VALUE_REFERENCES_PER_SCOPE + 1)
    expect(dbChainMockFns.values).toHaveBeenCalledWith({
      key,
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-2',
      source: 'execution_log',
    })
  })

  it('rejects materialized references once the scope reaches the reference cap', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([]).mockResolvedValueOnce(
      Array.from({ length: MAX_LARGE_VALUE_REFERENCES_PER_SCOPE }, (_, index) => ({
        key: largeValueKey(`d${index.toString(36).padStart(11, '0')}`),
      }))
    )

    await expect(
      addLargeValueReference(
        {
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-2',
          source: 'execution_log',
        },
        largeValueKey('zyxwvutsrqpo')
      )
    ).rejects.toThrow('exceeding the limit')

    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('prunes large value metadata in bounded batches', async () => {
    dbChainMockFns.execute
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

  it('uses source-specific liveness when pruning stale references', async () => {
    await pruneLargeValueMetadata({
      workspaceIds: ['workspace-1'],
      tombstonesDeletedBefore: new Date('2026-01-01T00:00:00Z'),
      batchSize: 10,
      maxRowsPerTable: 100,
    })

    const [query] = dbChainMockFns.execute.mock.calls[0] ?? []
    const sqlText = Array.isArray(query?.strings) ? query.strings.join(' ') : ''
    expect(sqlText).toContain("ref.source = 'execution_log'")
    expect(sqlText).toContain("ref.source = 'paused_snapshot'")
  })
})
