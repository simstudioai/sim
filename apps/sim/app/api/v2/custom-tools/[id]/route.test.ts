/**
 * @vitest-environment node
 *
 * Public v2 custom tool detail: the per-id get/update/delete the internal
 * surface never had, and the rename guard that keeps a duplicate title from
 * reaching the unique index.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockGetWorkspaceCustomTool,
  mockGetWorkspaceCustomToolByTitle,
  mockDeleteWorkspaceCustomTool,
  mockUpsertCustomTools,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockGetWorkspaceCustomTool: vi.fn(),
  mockGetWorkspaceCustomToolByTitle: vi.fn(),
  mockDeleteWorkspaceCustomTool: vi.fn(),
  mockUpsertCustomTools: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  getWorkspaceCustomTool: mockGetWorkspaceCustomTool,
  getWorkspaceCustomToolByTitle: mockGetWorkspaceCustomToolByTitle,
  deleteWorkspaceCustomTool: mockDeleteWorkspaceCustomTool,
  upsertCustomTools: mockUpsertCustomTools,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { DELETE, GET, PATCH } from '@/app/api/v2/custom-tools/[id]/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

const RATE_LIMIT_DENIED = {
  allowed: false,
  limit: 100,
  remaining: 0,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 1000,
}

const ACCESS_DENIED = { status: 403, code: 'FORBIDDEN', message: 'Access denied' }

const TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'lookup_order',
    parameters: { type: 'object', properties: { orderId: { type: 'string' } } },
  },
}

function buildTool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool_abc123',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    title: 'lookup_order',
    schema: TOOL_SCHEMA,
    code: 'return { ok: true }',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  }
}

const routeContext = () => ({ params: Promise.resolve({ id: 'tool_abc123' }) })
const url = (query = 'workspaceId=workspace-1') =>
  `http://localhost:3000/api/v2/custom-tools/tool_abc123?${query}`

const callGet = (query?: string) => GET(new NextRequest(url(query)), routeContext())
const callDelete = (query?: string) =>
  DELETE(new NextRequest(url(query), { method: 'DELETE' }), routeContext())

function callPatch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost:3000/api/v2/custom-tools/tool_abc123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    routeContext()
  )
}

describe('GET /api/v2/custom-tools/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetWorkspaceCustomTool.mockResolvedValue(buildTool())
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockGetWorkspaceCustomTool).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callGet('')
    expect(res.status).toBe(400)
    expect(mockGetWorkspaceCustomTool).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callGet()
    expect(res.status).toBe(403)
    expect(mockGetWorkspaceCustomTool).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callGet()
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the tool is not in the workspace', async () => {
    mockGetWorkspaceCustomTool.mockResolvedValue(null)
    const res = await callGet()
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('returns the public tool shape without internal scoping columns', async () => {
    const res = await callGet()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.customTool).toEqual({
      id: 'tool_abc123',
      title: 'lookup_order',
      schema: TOOL_SCHEMA,
      code: 'return { ok: true }',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    })
    expect(mockGetWorkspaceCustomTool).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      toolId: 'tool_abc123',
    })
  })
})

describe('PATCH /api/v2/custom-tools/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetWorkspaceCustomTool.mockResolvedValue(buildTool())
    mockGetWorkspaceCustomToolByTitle.mockResolvedValue(null)
    mockUpsertCustomTools.mockResolvedValue([buildTool()])
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callPatch({ workspaceId: 'workspace-1', code: 'return 1' })

    expect(res.status).toBe(404)
    expect(mockUpsertCustomTools).not.toHaveBeenCalled()
  })

  it('400s when no field to change is supplied', async () => {
    const res = await callPatch({ workspaceId: 'workspace-1' })
    expect(res.status).toBe(400)
    expect(mockUpsertCustomTools).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callPatch({ workspaceId: 'workspace-1', code: 'return 1' })
    expect(res.status).toBe(403)
    expect(mockUpsertCustomTools).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callPatch({ workspaceId: 'workspace-1', code: 'return 1' })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the tool is not in the workspace', async () => {
    mockGetWorkspaceCustomTool.mockResolvedValue(null)
    const res = await callPatch({ workspaceId: 'workspace-1', code: 'return 1' })
    expect(res.status).toBe(404)
    expect(mockUpsertCustomTools).not.toHaveBeenCalled()
  })

  it('409s when renaming onto an existing title', async () => {
    mockGetWorkspaceCustomToolByTitle.mockResolvedValue(buildTool({ id: 'tool_other' }))

    const res = await callPatch({ workspaceId: 'workspace-1', title: 'taken' })

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
    expect(mockUpsertCustomTools).not.toHaveBeenCalled()
  })

  it('merges the partial body against the stored tool', async () => {
    const res = await callPatch({ workspaceId: 'workspace-1', code: 'return 2' })

    expect(res.status).toBe(200)
    expect(mockUpsertCustomTools).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        tools: [
          {
            id: 'tool_abc123',
            title: 'lookup_order',
            schema: TOOL_SCHEMA,
            code: 'return 2',
          },
        ],
      })
    )
  })
})

describe('DELETE /api/v2/custom-tools/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetWorkspaceCustomTool.mockResolvedValue(buildTool())
    mockDeleteWorkspaceCustomTool.mockResolvedValue(true)
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callDelete()

    expect(res.status).toBe(404)
    expect(mockDeleteWorkspaceCustomTool).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callDelete('')
    expect(res.status).toBe(400)
    expect(mockDeleteWorkspaceCustomTool).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callDelete()
    expect(res.status).toBe(403)
    expect(mockDeleteWorkspaceCustomTool).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callDelete()
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the tool is not in the workspace', async () => {
    mockGetWorkspaceCustomTool.mockResolvedValue(null)
    const res = await callDelete()
    expect(res.status).toBe(404)
    expect(mockDeleteWorkspaceCustomTool).not.toHaveBeenCalled()
  })

  it('deletes the tool and acknowledges the id', async () => {
    const res = await callDelete()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { id: 'tool_abc123', deleted: true } })
    expect(mockDeleteWorkspaceCustomTool).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      toolId: 'tool_abc123',
    })
  })
})
