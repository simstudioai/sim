/**
 * @vitest-environment node
 *
 * Tests for GET /api/v1/workflows/[id]/export — verifies auth, workspace
 * permission enforcement (masked as 404), payload shape, secret sanitization,
 * and edge-handle normalization.
 */

import { createMockRequest, workflowAuthzMockFns } from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockValidateWorkspaceAccess,
  mockLoadWorkflowFromNormalizedTables,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockValidateWorkspaceAccess: vi.fn(),
  mockLoadWorkflowFromNormalizedTables: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitResponse: vi.fn(() =>
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  ),
  validateWorkspaceAccess: mockValidateWorkspaceAccess,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mockLoadWorkflowFromNormalizedTables,
}))

vi.mock('@/app/api/v1/logs/meta', () => ({
  getUserLimits: vi.fn().mockResolvedValue({}),
  createApiResponse: vi.fn((body: unknown) => ({ body, headers: {} })),
}))

vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: { WORKFLOW_EXPORTED: 'workflow.exported' },
  AuditResourceType: { WORKFLOW: 'workflow' },
}))

/**
 * Overrides the global registry mock (whose blocks declare no subBlocks) so
 * `sanitizeForExport` has a `password: true` field to actually redact.
 */
vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn(() => ({
    name: 'Starter',
    description: 'Mock block',
    icon: () => null,
    subBlocks: [
      { id: 'apiKey', type: 'short-input', password: true },
      { id: 'endpoint', type: 'short-input' },
      { id: 'secretFromEnv', type: 'short-input', password: true },
    ],
    outputs: {},
  })),
  getAllBlocks: vi.fn(() => []),
  getLatestBlock: vi.fn(() => undefined),
  getBlockByToolName: vi.fn(() => undefined),
}))

import { GET } from '@/app/api/v1/workflows/[id]/export/route'

const WORKFLOW_ID = 'wf-1'

const WORKFLOW_RECORD = {
  id: WORKFLOW_ID,
  name: 'My Workflow',
  description: 'Does a thing',
  workspaceId: 'ws-1',
  folderId: 'folder-1',
  variables: {
    'var-1': { id: 'var-1', name: 'apiHost', type: 'string', value: 'https://example.com' },
  },
}

const NORMALIZED_STATE = {
  blocks: {
    'block-1': {
      id: 'block-1',
      type: 'starter',
      name: 'Start',
      position: { x: 0, y: 0 },
      subBlocks: {
        apiKey: { id: 'apiKey', type: 'short-input', value: 'sk-super-secret' },
        endpoint: { id: 'endpoint', type: 'short-input', value: 'https://api.example.com' },
        secretFromEnv: { id: 'secretFromEnv', type: 'short-input', value: '{{MY_SECRET}}' },
      },
      outputs: {},
      enabled: true,
    },
  },
  edges: [
    {
      id: 'edge-1',
      source: 'block-1',
      target: 'block-2',
      sourceHandle: null,
      targetHandle: 'target',
    },
  ],
  loops: {},
  parallels: {},
  isFromNormalizedTables: true,
}

function makeContext(id = WORKFLOW_ID) {
  return { params: Promise.resolve({ id }) }
}

function makeRequest() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/v1/workflows/${WORKFLOW_ID}/export`
  )
}

describe('GET /api/v1/workflows/[id]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    workflowAuthzMockFns.mockGetActiveWorkflowRecord.mockResolvedValue(WORKFLOW_RECORD)
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(NORMALIZED_STATE)
  })

  it('returns 401 when the API key is rejected', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false })

    const response = await GET(makeRequest(), makeContext())

    expect(response.status).toBe(401)
  })

  it('returns 404 when the workflow does not exist', async () => {
    workflowAuthzMockFns.mockGetActiveWorkflowRecord.mockResolvedValue(null)

    const response = await GET(makeRequest(), makeContext())

    expect(response.status).toBe(404)
  })

  it('masks a permission failure as 404 so callers cannot probe existence', async () => {
    mockValidateWorkspaceAccess.mockResolvedValue(
      NextResponse.json({ error: 'Access denied' }, { status: 403 })
    )

    const response = await GET(makeRequest(), makeContext())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow not found' })
  })

  it('returns 404 when the workflow row exists but its state does not', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(null)

    const response = await GET(makeRequest(), makeContext())

    expect(response.status).toBe(404)
  })

  it('returns the export envelope with workflow metadata and state', async () => {
    const response = await GET(makeRequest(), makeContext())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.version).toBe('1.0')
    expect(typeof body.data.exportedAt).toBe('string')
    expect(body.data.workflow).toEqual({
      id: WORKFLOW_ID,
      name: 'My Workflow',
      description: 'Does a thing',
      workspaceId: 'ws-1',
      folderId: 'folder-1',
    })
    expect(body.data.state.metadata).toMatchObject({
      name: 'My Workflow',
      description: 'Does a thing',
    })
    expect(Object.keys(body.data.state.blocks)).toEqual(['block-1'])
  })

  it('strips secret sub-block values but preserves env-var references', async () => {
    const response = await GET(makeRequest(), makeContext())
    const body = await response.json()

    const subBlocks = body.data.state.blocks['block-1'].subBlocks
    expect(JSON.stringify(body)).not.toContain('sk-super-secret')
    expect(subBlocks.apiKey.value).toBeNull()
    expect(subBlocks.endpoint.value).toBe('https://api.example.com')
    expect(subBlocks.secretFromEnv.value).toBe('{{MY_SECRET}}')
  })

  it('normalizes null edge handles to omitted values', async () => {
    const response = await GET(makeRequest(), makeContext())
    const body = await response.json()

    const [edge] = body.data.state.edges
    expect(edge.sourceHandle).toBeUndefined()
    expect(edge.targetHandle).toBe('target')
  })

  it('records a workflow-exported audit entry', async () => {
    await GET(makeRequest(), makeContext())

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.exported',
        resourceId: WORKFLOW_ID,
        workspaceId: 'ws-1',
        actorId: 'user-1',
      })
    )
  })
})
