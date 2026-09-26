/**
 * Tests for GET /api/v1/workflows/[id]/export — verifies auth, workspace
 * permission enforcement (masked as 404), payload shape, secret sanitization,
 * and edge-handle normalization.
 */

import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1LogsMetaMock, v1LogsMetaMockFns } from '@sim/testing/mocks/v1-logs-meta.mock'
import { v1MiddlewareMock, v1MiddlewareMockFns } from '@sim/testing/mocks/v1-middleware.mock'
import { workflowAuthzMockFns } from '@sim/testing/mocks/workflow-authz.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/v1/middleware', () => v1MiddlewareMock)

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/app/api/v1/logs/meta', () => v1LogsMetaMock)

vi.mock('@sim/audit', () => auditMock)

import { GET } from '@/app/api/v1/workflows/[id]/export/route'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'

const { mockCheckRateLimit, mockValidateWorkspaceAccess } = v1MiddlewareMockFns
v1MiddlewareMockFns.mockCreateRateLimitResponse.mockImplementation(() =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
)

v1LogsMetaMockFns.mockCreateApiResponse.mockImplementation((body: unknown) => ({
  body,
  headers: {},
}))

const mockLoadWorkflowFromNormalizedTables =
  workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables

/**
 * Overrides the global registry mock (whose blocks declare no subBlocks) so
 * `sanitizeForExport` has a `password: true` field to actually redact.
 */
vi.mocked(getBlock).mockReturnValue({
  name: 'Starter',
  description: 'Mock block',
  icon: () => null,
  subBlocks: [
    { id: 'apiKey', type: 'short-input', password: true },
    { id: 'endpoint', type: 'short-input' },
    { id: 'secretFromEnv', type: 'short-input', password: true },
  ],
  outputs: {},
} as unknown as BlockConfig)

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
  return createRouteContext({ id })
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
    mockCheckRateLimit.mockResolvedValue({ allowed: true, userId: 'user-1' })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    workflowAuthzMockFns.mockGetActiveWorkflowRecord.mockResolvedValue(WORKFLOW_RECORD)
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(NORMALIZED_STATE)
  })

  it('masks a permission failure as 404 so callers cannot probe existence', async () => {
    mockValidateWorkspaceAccess.mockResolvedValue(
      NextResponse.json({ error: 'Access denied' }, { status: 403 })
    )

    const response = await GET(makeRequest(), makeContext())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow not found' })
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
})
