import { workflowExecutionLogs } from '@sim/db/schema'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { traceStoreMock, traceStoreMockFns } from '@sim/testing/mocks/trace-store.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExpandFolderIdsWithDescendants, mockMapWithConcurrency } = vi.hoisted(() => ({
  mockExpandFolderIdsWithDescendants: vi.fn(),
  mockMapWithConcurrency: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/logs/folder-expansion', () => ({
  expandFolderIdsWithDescendants: mockExpandFolderIdsWithDescendants,
}))

vi.mock('@/lib/logs/execution/trace-store', () => traceStoreMock)

vi.mock('@/lib/core/utils/concurrency', () => ({
  MATERIALIZE_CONCURRENCY: 20,
  mapWithConcurrency: mockMapWithConcurrency,
}))

import { capabilityRefusal } from '@/lib/permission-groups/capabilities'
import { GET } from '@/app/api/logs/export/route'

const { mockMaterializeExecutionDataForDisplay } = traceStoreMockFns

const mockGetSession = authMockFns.mockGetSession
const mockCheckWorkspaceAccess = permissionsMockFns.mockCheckWorkspaceAccess
const mockGetUserPermissionConfig = permissionGroupsResolveMockFns.mockGetUserPermissionConfig
const STARTED_AT = new Date('2026-08-23T12:00:00.000Z')

function makeRequest() {
  return createMockRequest({ url: 'http://localhost:3000/api/logs/export?workspaceId=workspace-1' })
}

function logRow(index: number, overrides: Record<string, unknown> = {}) {
  const startedAt = new Date(STARTED_AT.getTime() - index * 1000)
  return {
    id: `log-${index.toString().padStart(4, '0')}`,
    workflowId: 'workflow-1',
    executionId: `execution-${index}`,
    level: 'info',
    trigger: 'manual',
    startedAt,
    startedAtCursor: startedAt.toISOString(),
    endedAt: new Date(STARTED_AT.getTime() - index * 1000 + 500),
    totalDurationMs: 500,
    costTotal: '0.01',
    executionData: { message: `message-${index}` },
    workflowName: 'Workflow',
    ...overrides,
  }
}

function flattenConditions(condition: unknown): Array<Record<string, unknown>> {
  if (!condition || typeof condition !== 'object') return []
  const node = condition as Record<string, unknown>
  if (Array.isArray(node.conditions)) {
    return node.conditions.flatMap(flattenConditions)
  }
  return [node]
}

describe('GET /api/logs/export', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true })
    mockGetUserPermissionConfig.mockResolvedValue(null)
    mockExpandFolderIdsWithDescendants.mockImplementation(
      async (_workspaceId: string, folderIds: string | undefined) => folderIds
    )
    mockMaterializeExecutionDataForDisplay.mockImplementation(
      async (executionData: Record<string, unknown> | null | undefined) => executionData ?? {}
    )
    mockMapWithConcurrency.mockImplementation(
      async (
        items: unknown[],
        _limit: number,
        mapper: (item: unknown, index: number) => Promise<unknown>
      ) => Promise.all(items.map(mapper))
    )
  })

  it('returns only the CSV header when workspace access is denied', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({ hasAccess: false })

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(
      'startedAt,level,workflow,trigger,durationMs,costTotal,workflowId,executionId,message,traceSpans\n'
    )
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
    expect(mockMaterializeExecutionDataForDisplay).not.toHaveBeenCalled()
  })

  it('materializes bounded chunks while preserving CSV row order', async () => {
    queueTableRows(
      workflowExecutionLogs,
      Array.from({ length: 45 }, (_, index) => logRow(index))
    )

    const response = await GET(makeRequest())
    const lines = (await response.text()).trimEnd().split('\n')

    expect(response.status).toBe(200)
    expect(mockMapWithConcurrency.mock.calls.map(([items]) => items.length)).toEqual([20, 20, 5])
    expect(lines).toHaveLength(46)
    expect(lines[1]).toContain('execution-0')
    expect(lines.at(-1)).toContain('execution-44')
  })

  it('resumes full pages by startedAt and id without using OFFSET', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => logRow(index))
    firstPage[99] = logRow(99, { startedAtCursor: '2026-08-23 11:58:21.000123' })
    const last = firstPage.at(-1)!
    const secondPage = [
      logRow(100, {
        id: 'log-0000-second',
        startedAt: last.startedAt,
        startedAtCursor: '2026-08-23 11:58:21.000122',
      }),
    ]
    queueTableRows(workflowExecutionLogs, firstPage)
    queueTableRows(workflowExecutionLogs, secondPage)

    const response = await GET(makeRequest())
    const lines = (await response.text()).trimEnd().split('\n')

    expect(lines).toHaveLength(102)
    expect(dbChainMockFns.offset).not.toHaveBeenCalled()
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.orderBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'desc',
        column: workflowExecutionLogs.startedAt,
      }),
      expect.objectContaining({
        type: 'desc',
        column: workflowExecutionLogs.id,
      })
    )

    const cursorConditions = flattenConditions(dbChainMockFns.where.mock.calls[1][0])
    const timestampConditions = cursorConditions.filter(
      (condition) => condition.left === workflowExecutionLogs.startedAt
    )
    expect(timestampConditions.map((condition) => condition.type)).toEqual(['lt', 'eq'])
    for (const condition of timestampConditions) {
      expect(condition.right).not.toBeInstanceOf(Date)
      expect(condition.right).toEqual(
        expect.objectContaining({ values: expect.arrayContaining([last.startedAtCursor]) })
      )
    }
    expect(cursorConditions).toContainEqual(
      expect.objectContaining({
        type: 'lt',
        left: workflowExecutionLogs.id,
        right: last.id,
      })
    )
  })

  it('does not load the next database page until the current row is consumed', async () => {
    queueTableRows(
      workflowExecutionLogs,
      Array.from({ length: 100 }, (_, index) => logRow(index))
    )
    queueTableRows(workflowExecutionLogs, [logRow(1)])

    const response = await GET(makeRequest())
    const reader = response.body!.getReader()

    await reader.read()
    expect(dbChainMockFns.where).not.toHaveBeenCalled()

    await reader.read()
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(1)

    await reader.cancel()
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(1)
  })

  it('stops a pending pull cleanly when the reader cancels', async () => {
    queueTableRows(workflowExecutionLogs, [logRow(0)])
    let resolveMaterialization: ((value: unknown[]) => void) | undefined
    mockMapWithConcurrency.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMaterialization = resolve
        })
    )

    const response = await GET(makeRequest())
    const reader = response.body!.getReader()
    await reader.read()

    const pendingRead = reader.read()
    await vi.waitFor(() => expect(mockMapWithConcurrency).toHaveBeenCalledTimes(1))
    const cancellation = reader.cancel()
    resolveMaterialization?.([{ message: 'message-0' }])

    await expect(Promise.all([pendingRead, cancellation])).resolves.toBeDefined()
  })

  it('blanks the cost column and span spend when the group withholds cost', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({ hideCostInfo: true })
    queueTableRows(workflowExecutionLogs, [
      logRow(0, {
        executionData: {
          message: 'message-0',
          traceSpans: [{ id: 'span-1', name: 'Agent', type: 'agent', cost: { total: 0.01 } }],
        },
      }),
    ])

    const response = await GET(makeRequest())
    const lines = (await response.text()).trimEnd().split('\n')

    expect(lines[0]).toContain('costTotal')
    expect(lines[1].split(',')[5]).toBe('')
    expect(lines[1]).toContain('span-1')
    expect(lines[1]).not.toContain('0.01')
  })

  it('refuses the download when the group withholds log export', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({ disableLogExport: true })
    queueTableRows(workflowExecutionLogs, [logRow(0)])

    const response = await GET(makeRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: capabilityRefusal('logs.export'),
    })
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  /**
   * The decision, pinned: `logs.export` has no admin exemption. The refusal is
   * reached without reading a role at all — no organization membership, no
   * workspace permission row — so an exemption cannot be added without this
   * failing.
   */
  it("refuses the download without consulting the caller's role", async () => {
    mockGetUserPermissionConfig.mockResolvedValue({ disableLogExport: true })
    queueTableRows(workflowExecutionLogs, [logRow(0)])

    const response = await GET(makeRequest())

    expect(response.status).toBe(403)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('refuses a cost-filtered export when the group withholds spend', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({ hideCostInfo: true })
    queueTableRows(workflowExecutionLogs, [logRow(0)])

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/logs/export?workspaceId=workspace-1&costOperator=%3E&costValue=0.5'
      )
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: capabilityRefusal('logs.cost') })
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })
})
