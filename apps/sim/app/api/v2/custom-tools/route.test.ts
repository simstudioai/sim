/**
 * @vitest-environment node
 *
 * Public v2 custom tools list/create: gate ordering, contract validation, and
 * the workspace-scoped single-resource create that replaced the bulk upsert.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockListWorkspaceCustomTools,
  mockGetWorkspaceCustomToolByTitle,
  mockUpsertCustomTools,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockListWorkspaceCustomTools: vi.fn(),
  mockGetWorkspaceCustomToolByTitle: vi.fn(),
  mockUpsertCustomTools: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  listWorkspaceCustomTools: mockListWorkspaceCustomTools,
  getWorkspaceCustomToolByTitle: mockGetWorkspaceCustomToolByTitle,
  upsertCustomTools: mockUpsertCustomTools,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET, POST } from '@/app/api/v2/custom-tools/route'

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

const TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'lookup_order',
    description: 'Look up an order by id',
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
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

const callList = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/custom-tools?${query}`))

function callCreate(body: unknown) {
  return POST(
    new NextRequest('http://localhost:3000/api/v2/custom-tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

const VALID_BODY = {
  workspaceId: 'workspace-1',
  title: 'lookup_order',
  schema: TOOL_SCHEMA,
  code: 'return { ok: true }',
}

describe('GET /api/v2/custom-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockListWorkspaceCustomTools.mockResolvedValue([buildTool()])
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callList('workspaceId=workspace-1')

    expect(res.status).toBe(404)
    expect(mockListWorkspaceCustomTools).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callList('')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockListWorkspaceCustomTools).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callList('workspaceId=workspace-1')
    expect(res.status).toBe(403)
    expect(mockListWorkspaceCustomTools).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callList('workspaceId=workspace-1')
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('returns the public tool shape in the cursor envelope, workspace-scoped', async () => {
    const res = await callList('workspaceId=workspace-1')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.nextCursor).toBeNull()
    expect(body.data).toEqual([
      {
        id: 'tool_abc123',
        title: 'lookup_order',
        schema: TOOL_SCHEMA,
        code: 'return { ok: true }',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ])
    expect(mockListWorkspaceCustomTools).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
  })
})

describe('POST /api/v2/custom-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetWorkspaceCustomToolByTitle.mockResolvedValue(null)
    mockUpsertCustomTools.mockResolvedValue([buildTool()])
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callCreate(VALID_BODY)

    expect(res.status).toBe(404)
    expect(mockUpsertCustomTools).not.toHaveBeenCalled()
  })

  it('400s when the schema is not an OpenAI function declaration', async () => {
    const res = await callCreate({ ...VALID_BODY, schema: { type: 'nonsense' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockUpsertCustomTools).not.toHaveBeenCalled()
  })

  it('400s when the body carries an unknown field', async () => {
    const res = await callCreate({ ...VALID_BODY, bogus: true })
    expect(res.status).toBe(400)
    expect(mockUpsertCustomTools).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(403)
    expect(mockUpsertCustomTools).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('409s on a duplicate title instead of hitting the unique index', async () => {
    mockGetWorkspaceCustomToolByTitle.mockResolvedValue(buildTool())

    const res = await callCreate(VALID_BODY)

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
    expect(mockUpsertCustomTools).not.toHaveBeenCalled()
  })

  it('creates the tool and returns 201 with the single tool', async () => {
    const res = await callCreate(VALID_BODY)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.customTool).toMatchObject({ id: 'tool_abc123', title: 'lookup_order' })
    expect(mockUpsertCustomTools).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        tools: [{ title: 'lookup_order', schema: TOOL_SCHEMA, code: 'return { ok: true }' }],
      })
    )
  })
})
