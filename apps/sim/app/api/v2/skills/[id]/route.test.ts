/**
 * @vitest-environment node
 *
 * Public v2 skill detail: the get-by-id that has no internal equivalent, plus
 * the per-id update/delete that replaced the bulk upsert.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockGetSkillById,
  mockPerformUpdateSkill,
  mockPerformDeleteSkill,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockGetSkillById: vi.fn(),
  mockPerformUpdateSkill: vi.fn(),
  mockPerformDeleteSkill: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/workflows/skills/operations', () => ({
  getSkillById: mockGetSkillById,
}))

vi.mock('@/lib/skills/orchestration', () => ({
  performUpdateSkill: mockPerformUpdateSkill,
  performDeleteSkill: mockPerformDeleteSkill,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { DELETE, GET, PATCH } from '@/app/api/v2/skills/[id]/route'

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

function buildSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skl_abc123',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    name: 'refund-policy',
    description: 'How to handle refunds',
    content: '# Refund policy',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  }
}

const routeContext = () => ({ params: Promise.resolve({ id: 'skl_abc123' }) })
const url = (query = 'workspaceId=workspace-1') =>
  `http://localhost:3000/api/v2/skills/skl_abc123?${query}`

const callGet = (query?: string) => GET(new NextRequest(url(query)), routeContext())
const callDelete = (query?: string) =>
  DELETE(new NextRequest(url(query), { method: 'DELETE' }), routeContext())

function callPatch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost:3000/api/v2/skills/skl_abc123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    routeContext()
  )
}

describe('GET /api/v2/skills/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetSkillById.mockResolvedValue(buildSkill())
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockGetSkillById).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callGet('')
    expect(res.status).toBe(400)
    expect(mockGetSkillById).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callGet()
    expect(res.status).toBe(403)
    expect(mockGetSkillById).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callGet()
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the skill is not in the workspace', async () => {
    mockGetSkillById.mockResolvedValue(null)
    const res = await callGet()
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })

  it('returns the single skill including its body', async () => {
    const res = await callGet()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({
      skill: {
        id: 'skl_abc123',
        name: 'refund-policy',
        description: 'How to handle refunds',
        content: '# Refund policy',
        readOnly: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    })
    expect(mockGetSkillById).toHaveBeenCalledWith({
      skillId: 'skl_abc123',
      workspaceId: 'workspace-1',
    })
  })
})

describe('PATCH /api/v2/skills/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformUpdateSkill.mockResolvedValue({
      success: true,
      skill: buildSkill({ description: 'Updated' }),
    })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callPatch({ workspaceId: 'workspace-1', description: 'Updated' })

    expect(res.status).toBe(404)
    expect(mockPerformUpdateSkill).not.toHaveBeenCalled()
  })

  it('400s when no field to change is supplied', async () => {
    const res = await callPatch({ workspaceId: 'workspace-1' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformUpdateSkill).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callPatch({ workspaceId: 'workspace-1', description: 'Updated' })
    expect(res.status).toBe(403)
    expect(mockPerformUpdateSkill).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callPatch({ workspaceId: 'workspace-1', description: 'Updated' })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('403s when the caller is not a skill editor', async () => {
    mockPerformUpdateSkill.mockResolvedValue({
      success: false,
      error: 'Skill editor access required to modify "refund-policy"',
      errorCode: 'forbidden',
    })
    const res = await callPatch({ workspaceId: 'workspace-1', description: 'Updated' })
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('FORBIDDEN')
  })

  it('400s when the orchestration rejects a built-in skill', async () => {
    mockPerformUpdateSkill.mockResolvedValue({
      success: false,
      error: 'Built-in skills are read-only and cannot be modified',
      errorCode: 'validation',
    })
    const res = await callPatch({ workspaceId: 'workspace-1', description: 'Updated' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('Built-in')
  })

  it('updates the skill and returns the single skill', async () => {
    const res = await callPatch({ workspaceId: 'workspace-1', description: 'Updated' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.skill.description).toBe('Updated')
    expect(Array.isArray(body.data)).toBe(false)
    expect(mockPerformUpdateSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        skillId: 'skl_abc123',
        description: 'Updated',
        source: 'api',
      })
    )
  })
})

describe('DELETE /api/v2/skills/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformDeleteSkill.mockResolvedValue({ success: true, skill: buildSkill() })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callDelete()

    expect(res.status).toBe(404)
    expect(mockPerformDeleteSkill).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callDelete('')
    expect(res.status).toBe(400)
    expect(mockPerformDeleteSkill).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callDelete()
    expect(res.status).toBe(403)
    expect(mockPerformDeleteSkill).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callDelete()
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('400s when the skill is a read-only built-in', async () => {
    mockPerformDeleteSkill.mockResolvedValue({
      success: false,
      error: 'Built-in skills are read-only and cannot be modified',
      errorCode: 'validation',
    })
    const res = await callDelete()
    expect(res.status).toBe(400)
  })

  it('deletes the skill and acknowledges the id', async () => {
    const res = await callDelete()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { id: 'skl_abc123', deleted: true } })
    expect(mockPerformDeleteSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        skillId: 'skl_abc123',
        source: 'api',
      })
    )
  })
})
