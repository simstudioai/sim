/**
 * Tests for POST /api/v1/workflows/import — verifies auth, write-permission
 * enforcement, payload-shape tolerance (export envelope / bare state / JSON
 * string), metadata resolution, variable persistence, and rollback when
 * persisting the imported state fails.
 */

import { workspace } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1LogsMetaMock, v1LogsMetaMockFns } from '@sim/testing/mocks/v1-logs-meta.mock'
import { v1MiddlewareMock, v1MiddlewareMockFns } from '@sim/testing/mocks/v1-middleware.mock'
import { workflowAuthzMockFns } from '@sim/testing/mocks/workflow-authz.mock'
import {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing/mocks/workflows-orchestration.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockParseWorkflowJson,
  mockExtractAndPersistCustomTools,
  mockPrepareWorkflowState,
  mockDbUpdate,
} = vi.hoisted(() => ({
  mockParseWorkflowJson: vi.fn(),
  mockExtractAndPersistCustomTools: vi.fn(),
  mockPrepareWorkflowState: vi.fn(),
  mockDbUpdate: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => v1MiddlewareMock)

vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)

vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/workflows/operations/import-export', () => ({
  parseWorkflowJson: mockParseWorkflowJson,
}))

vi.mock('@/app/api/v1/logs/meta', () => v1LogsMetaMock)

vi.mock('@/lib/workflows/persistence/custom-tools-persistence', () => ({
  extractAndPersistCustomTools: mockExtractAndPersistCustomTools,
}))

/**
 * Mocked to keep the block registry (and its icon/CSS graph) out of this
 * suite. The real normalization is covered by `prepare-state.test.ts` and by
 * the end-to-end round trip in `import-export-roundtrip.test.ts`.
 */
vi.mock('@/lib/workflows/persistence/prepare-state', () => ({
  prepareWorkflowStateForPersistence: mockPrepareWorkflowState,
}))

import { POST } from '@/app/api/v1/workflows/import/route'

const { mockPerformCreateWorkflow } = workflowsOrchestrationMockFns
const { mockCheckRateLimit, mockValidateWorkspaceAccess } = v1MiddlewareMockFns
v1MiddlewareMockFns.mockCreateRateLimitResponse.mockImplementation(() =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
)

v1LogsMetaMockFns.mockCreateApiResponse.mockImplementation((body: unknown) => ({
  body,
  headers: {},
}))

const mockSaveWorkflowToNormalizedTables =
  workflowsPersistenceUtilsMockFns.mockSaveWorkflowToNormalizedTables
const mockNotifyWorkspaceWorkflowsChanged =
  realtimeNotifyMockFns.mockNotifyWorkspaceWorkflowsChanged
const mockAssertFolderMutable = workflowAuthzMockFns.mockAssertFolderMutable
const mockAssertFolderInWorkspace = workflowAuthzMockFns.mockAssertFolderInWorkspace
const mockDbDelete = dbChainMockFns.delete

const WORKSPACE_ID = 'ws-1'
const CREATED_AT = new Date('2026-07-01T00:00:00Z')

/** A schema-valid block: the route now gates on `workflowStateSchema`. */
const VALID_BLOCK = {
  id: 'block-1',
  type: 'starter',
  name: 'Start',
  position: { x: 0, y: 0 },
  subBlocks: {},
  outputs: {},
  enabled: true,
}

const PARSED_STATE = {
  blocks: { 'block-1': VALID_BLOCK },
  edges: [],
  loops: {},
  parallels: {},
  variables: undefined as unknown,
}

const EXPORT_ENVELOPE = {
  version: '1.0',
  exportedAt: '2026-07-01T00:00:00.000Z',
  workflow: {
    id: 'wf-source',
    name: 'Payload Name',
    description: 'Payload description',
    workspaceId: 'ws-other',
    folderId: null,
  },
  state: { blocks: PARSED_STATE.blocks, edges: [], loops: {}, parallels: {} },
}

function makeRequest(body: unknown) {
  return createMockRequest('POST', body, {}, 'http://localhost:3000/api/v1/workflows/import')
}

function validBody(overrides: Record<string, unknown> = {}) {
  return { workspaceId: WORKSPACE_ID, workflow: EXPORT_ENVELOPE, ...overrides }
}

describe('POST /api/v1/workflows/import', () => {
  beforeEach(() => {
    resetDbChainMock()
    queueTableRows(workspace, [{ id: WORKSPACE_ID }])
    dbChainMockFns.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
      fn({ update: mockDbUpdate })
    )
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    mockAssertFolderMutable.mockResolvedValue(undefined)
    mockAssertFolderInWorkspace.mockResolvedValue(undefined)
    mockExtractAndPersistCustomTools.mockResolvedValue({ saved: 0, errors: [] })
    mockPrepareWorkflowState.mockImplementation((state: { blocks: unknown; edges: unknown }) => ({
      state: { blocks: state.blocks, edges: state.edges, loops: {}, parallels: {} },
      warnings: [],
    }))
    mockParseWorkflowJson.mockReturnValue({ data: { ...PARSED_STATE }, errors: [] })
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    mockPerformCreateWorkflow.mockResolvedValue({
      success: true,
      workflow: {
        id: 'wf-new',
        name: 'Payload Name',
        description: 'Payload description',
        workspaceId: WORKSPACE_ID,
        folderId: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    })
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    mockDbUpdate.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    })
  })

  it('requires write permission on the target workspace', async () => {
    mockValidateWorkspaceAccess.mockResolvedValue(
      NextResponse.json({ error: 'Access denied' }, { status: 403 })
    )

    const response = await POST(makeRequest(validBody()))

    expect(response.status).toBe(403)
    expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      WORKSPACE_ID,
      'none',
      'write'
    )
    expect(mockPerformCreateWorkflow).not.toHaveBeenCalled()
  })

  it('normalizes legacy array-form variables into a keyed record', async () => {
    const setSpy = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))
    mockDbUpdate.mockReturnValue({ set: setSpy })
    mockParseWorkflowJson.mockReturnValue({
      data: {
        ...PARSED_STATE,
        variables: [{ id: 'var-1', name: 'host', type: 'string', value: 'x' }],
      },
      errors: [],
    })

    await POST(makeRequest(validBody()))

    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { 'var-1': { id: 'var-1', name: 'host', type: 'string', value: 'x' } },
      })
    )
  })

  it('deletes the created row and returns 500 when persisting state fails', async () => {
    const whereSpy = vi.fn().mockResolvedValue(undefined)
    mockDbDelete.mockReturnValue({ where: whereSpy })
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: false, error: 'boom' })

    const response = await POST(makeRequest(validBody()))

    expect(response.status).toBe(500)
    expect(mockDbDelete).toHaveBeenCalled()
    expect(whereSpy).toHaveBeenCalled()
  })

  it('rolls back the created workflow when the variables write throws', async () => {
    const whereSpy = vi.fn().mockResolvedValue(undefined)
    mockDbDelete.mockReturnValue({ where: whereSpy })
    mockDbUpdate.mockImplementation(() => {
      throw new Error('variables write failed')
    })
    mockParseWorkflowJson.mockReturnValue({
      data: {
        ...PARSED_STATE,
        variables: { 'var-1': { id: 'var-1', name: 'host', type: 'string', value: 'x' } },
      },
      errors: [],
    })

    const response = await POST(makeRequest(validBody()))

    expect(response.status).toBe(500)
    expect(mockDbDelete).toHaveBeenCalled()
    expect(whereSpy).toHaveBeenCalled()
  })

  it('caps a payload-derived name at the declared bound, ellipsis included', async () => {
    await POST(
      makeRequest(
        validBody({
          workflow: { ...EXPORT_ENVELOPE, workflow: { name: 'N'.repeat(500) } },
        })
      )
    )

    const { name } = mockPerformCreateWorkflow.mock.calls[0][0]
    expect(name.length).toBeLessThanOrEqual(200)
    expect(name.endsWith('...')).toBe(true)
  })
})
