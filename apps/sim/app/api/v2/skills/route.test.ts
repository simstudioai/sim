/**
 * @vitest-environment node
 *
 * Public v2 skills list/create: gate ordering, contract validation, and the
 * single-resource create that replaced the internal bulk upsert.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess, mockListSkills, mockPerformCreateSkill } =
  vi.hoisted(() => ({
    mockCheckRateLimit: vi.fn(),
    mockResolveWorkspaceAccess: vi.fn(),
    mockListSkills: vi.fn(),
    mockPerformCreateSkill: vi.fn(),
  }))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/workflows/skills/operations', () => ({
  listSkills: mockListSkills,
}))

vi.mock('@/lib/skills/orchestration', () => ({
  performCreateSkill: mockPerformCreateSkill,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET, POST } from '@/app/api/v2/skills/route'

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

function buildSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skl_abc123',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    name: 'refund-policy',
    description: 'How to handle refunds',
    content: '# Refund policy\n\nAlways be kind.',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  }
}

function callList(query: string) {
  return GET(new NextRequest(`http://localhost:3000/api/v2/skills?${query}`))
}

function callCreate(body: unknown) {
  return POST(
    new NextRequest('http://localhost:3000/api/v2/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

const VALID_BODY = {
  workspaceId: 'workspace-1',
  name: 'refund-policy',
  description: 'How to handle refunds',
  content: '# Refund policy',
}

describe('GET /api/v2/skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockListSkills.mockResolvedValue([buildSkill()])
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callList('workspaceId=workspace-1')

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
    expect(mockListSkills).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callList('')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockListSkills).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callList('workspaceId=workspace-1')
    expect(res.status).toBe(403)
    expect(mockListSkills).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callList('workspaceId=workspace-1')
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('returns summaries without skill bodies in the cursor envelope', async () => {
    const res = await callList('workspaceId=workspace-1')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.nextCursor).toBeNull()
    expect(body.data).toEqual([
      {
        id: 'skl_abc123',
        name: 'refund-policy',
        description: 'How to handle refunds',
        readOnly: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ])
    expect(mockListSkills).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
  })
})

describe('POST /api/v2/skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformCreateSkill.mockResolvedValue({ success: true, skill: buildSkill() })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callCreate(VALID_BODY)

    expect(res.status).toBe(404)
    expect(mockPerformCreateSkill).not.toHaveBeenCalled()
  })

  it('400s when the body is missing content', async () => {
    const res = await callCreate({
      workspaceId: 'workspace-1',
      name: 'refund-policy',
      description: 'How to handle refunds',
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformCreateSkill).not.toHaveBeenCalled()
  })

  it('400s when the name is not kebab-case', async () => {
    const res = await callCreate({ ...VALID_BODY, name: 'Refund Policy' })
    expect(res.status).toBe(400)
    expect(mockPerformCreateSkill).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(403)
    expect(mockPerformCreateSkill).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('400s when the orchestration rejects a built-in skill name', async () => {
    mockPerformCreateSkill.mockResolvedValue({
      success: false,
      error: 'The skill name "deploy-workflow" is reserved by a built-in skill',
      errorCode: 'validation',
    })

    const res = await callCreate({ ...VALID_BODY, name: 'deploy-workflow' })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toContain('built-in')
  })

  it('409s when the skill name is already taken', async () => {
    mockPerformCreateSkill.mockResolvedValue({
      success: false,
      error: 'The skill name "refund-policy" is unavailable in this workspace',
      errorCode: 'conflict',
    })
    const res = await callCreate(VALID_BODY)
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
  })

  it('creates the skill and returns 201 with the single skill, not the workspace list', async () => {
    const res = await callCreate(VALID_BODY)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({
      skill: {
        id: 'skl_abc123',
        name: 'refund-policy',
        description: 'How to handle refunds',
        content: '# Refund policy\n\nAlways be kind.',
        readOnly: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    })
    expect(mockPerformCreateSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        name: 'refund-policy',
        description: 'How to handle refunds',
        content: '# Refund policy',
        source: 'api',
      })
    )
  })
})
