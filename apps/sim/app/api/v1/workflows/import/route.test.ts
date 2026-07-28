/**
 * @vitest-environment node
 *
 * Tests for POST /api/v1/workflows/import — verifies auth, write-permission
 * enforcement, payload-shape tolerance (export envelope / bare state / JSON
 * string), metadata resolution, variable persistence, and rollback when
 * persisting the imported state fails.
 */

import { createMockRequest } from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockValidateWorkspaceAccess,
  mockPerformCreateWorkflow,
  mockSaveWorkflowToNormalizedTables,
  mockParseWorkflowJson,
  mockAssertFolderMutable,
  mockDbDelete,
  mockDbUpdate,
  mockWorkspaceRows,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockValidateWorkspaceAccess: vi.fn(),
  mockPerformCreateWorkflow: vi.fn(),
  mockSaveWorkflowToNormalizedTables: vi.fn(),
  mockParseWorkflowJson: vi.fn(),
  mockAssertFolderMutable: vi.fn(),
  mockDbDelete: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockWorkspaceRows: { value: [{ id: 'ws-1' }] as Array<{ id: string }> },
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitResponse: vi.fn(() =>
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  ),
  validateWorkspaceAccess: mockValidateWorkspaceAccess,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performCreateWorkflow: mockPerformCreateWorkflow,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
}))

vi.mock('@/lib/workflows/operations/import-export', () => ({
  parseWorkflowJson: mockParseWorkflowJson,
}))

vi.mock('@/app/api/v1/logs/meta', () => ({
  getUserLimits: vi.fn().mockResolvedValue({}),
  createApiResponse: vi.fn((body: unknown) => ({ body, headers: {} })),
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  assertFolderMutable: mockAssertFolderMutable,
  FolderLockedError: class FolderLockedError extends Error {
    status = 423
  },
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => mockWorkspaceRows.value),
        })),
      })),
    })),
    delete: mockDbDelete,
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({ update: mockDbUpdate })),
  },
}))

import { POST } from '@/app/api/v1/workflows/import/route'

const WORKSPACE_ID = 'ws-1'
const CREATED_AT = new Date('2026-07-01T00:00:00Z')

const PARSED_STATE = {
  blocks: { 'block-1': { id: 'block-1', type: 'starter', position: { x: 0, y: 0 } } },
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
    vi.clearAllMocks()
    mockWorkspaceRows.value = [{ id: WORKSPACE_ID }]
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    mockAssertFolderMutable.mockResolvedValue(undefined)
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

  it('returns 401 when the API key is rejected', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false })

    const response = await POST(makeRequest(validBody()))

    expect(response.status).toBe(401)
  })

  it('rejects a body without workspaceId', async () => {
    const response = await POST(makeRequest({ workflow: EXPORT_ENVELOPE }))

    expect(response.status).toBe(400)
  })

  it('rejects a body without a workflow payload', async () => {
    const response = await POST(makeRequest({ workspaceId: WORKSPACE_ID }))

    expect(response.status).toBe(400)
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
      'write'
    )
    expect(mockPerformCreateWorkflow).not.toHaveBeenCalled()
  })

  it('authorizes before touching the payload', async () => {
    mockValidateWorkspaceAccess.mockResolvedValue(
      NextResponse.json({ error: 'Access denied' }, { status: 403 })
    )

    await POST(makeRequest(validBody()))

    expect(mockParseWorkflowJson).not.toHaveBeenCalled()
  })

  it('returns 404 when the target workspace does not exist', async () => {
    mockWorkspaceRows.value = []

    const response = await POST(makeRequest(validBody()))

    expect(response.status).toBe(404)
  })

  it('returns 400 with parser errors for an invalid workflow payload', async () => {
    mockParseWorkflowJson.mockReturnValue({
      data: null,
      errors: ['Missing or invalid field: blocks'],
    })

    const response = await POST(makeRequest(validBody()))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid workflow: Missing or invalid field: blocks',
    })
  })

  it('creates the workflow and returns 201 with the resource shape', async () => {
    const response = await POST(makeRequest(validBody()))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.data).toEqual({
      id: 'wf-new',
      name: 'Payload Name',
      description: 'Payload description',
      workspaceId: WORKSPACE_ID,
      folderId: null,
      createdAt: CREATED_AT.toISOString(),
      updatedAt: CREATED_AT.toISOString(),
    })
    expect(mockSaveWorkflowToNormalizedTables).toHaveBeenCalledWith(
      'wf-new',
      expect.anything(),
      expect.anything()
    )
  })

  it('derives the name from the export envelope and deduplicates it', async () => {
    await POST(makeRequest(validBody()))

    expect(mockPerformCreateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Payload Name',
        description: 'Payload description',
        workspaceId: WORKSPACE_ID,
        deduplicate: true,
        userId: 'user-1',
      })
    )
  })

  it('prefers the explicit name and description overrides', async () => {
    await POST(makeRequest(validBody({ name: 'Override', description: 'Override desc' })))

    expect(mockPerformCreateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Override', description: 'Override desc' })
    )
  })

  it('falls back to a default name when the payload carries no metadata', async () => {
    await POST(
      makeRequest({
        workspaceId: WORKSPACE_ID,
        workflow: { blocks: PARSED_STATE.blocks, edges: [] },
      })
    )

    expect(mockPerformCreateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Imported Workflow', description: '' })
    )
  })

  it('accepts a JSON string payload', async () => {
    const response = await POST(
      makeRequest(validBody({ workflow: JSON.stringify(EXPORT_ENVELOPE) }))
    )

    expect(response.status).toBe(201)
    expect(mockParseWorkflowJson).toHaveBeenCalledWith(JSON.stringify(EXPORT_ENVELOPE))
    expect(mockPerformCreateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Payload Name' })
    )
  })

  it('persists variables from the parsed state', async () => {
    mockParseWorkflowJson.mockReturnValue({
      data: {
        ...PARSED_STATE,
        variables: { 'var-1': { id: 'var-1', name: 'host', type: 'string', value: 'x' } },
      },
      errors: [],
    })

    await POST(makeRequest(validBody()))

    expect(mockDbUpdate).toHaveBeenCalled()
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

  it('skips the variables write when the payload has none', async () => {
    await POST(makeRequest(validBody()))

    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('writes the graph and variables inside a single transaction', async () => {
    mockParseWorkflowJson.mockReturnValue({
      data: {
        ...PARSED_STATE,
        variables: { 'var-1': { id: 'var-1', name: 'host', type: 'string', value: 'x' } },
      },
      errors: [],
    })

    await POST(makeRequest(validBody()))

    const tx = { update: mockDbUpdate }
    expect(mockSaveWorkflowToNormalizedTables).toHaveBeenCalledWith('wf-new', expect.anything(), tx)
    expect(mockDbUpdate).toHaveBeenCalled()
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

  it('unwraps an export response envelope so its metadata still resolves', async () => {
    await POST(makeRequest(validBody({ workflow: { data: EXPORT_ENVELOPE, limits: {} } })))

    expect(mockPerformCreateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Payload Name', description: 'Payload description' })
    )
  })

  /**
   * Unreachable in practice — the route always passes `deduplicate: true`, so
   * the orchestrator renames instead of conflicting. Covers the defensive
   * mapping of the orchestrator's documented result union.
   */
  it('maps a conflict result from the orchestrator to 409', async () => {
    mockPerformCreateWorkflow.mockResolvedValue({
      success: false,
      error: 'A workflow named "Payload Name" already exists in this folder',
      errorCode: 'conflict',
    })

    const response = await POST(makeRequest(validBody()))

    expect(response.status).toBe(409)
  })

  it('maps an invalid target folder from the orchestrator to 400', async () => {
    mockPerformCreateWorkflow.mockResolvedValue({
      success: false,
      error: 'Target folder not found',
      errorCode: 'validation',
    })

    const response = await POST(makeRequest(validBody({ folderId: 'folder-x' })))

    expect(response.status).toBe(400)
  })
})
