/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { envState, mockCheckSessionOrInternalAuth } = vi.hoisted(() => ({
  envState: { MANAGED_AGENT_SELF_HOSTED_DEFAULTS: undefined as string | undefined },
  mockCheckSessionOrInternalAuth: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => (envState as Record<string, unknown>)[key as string],
  }),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

import { GET } from '@/app/api/managed-agent-defaults/route'

describe('GET /api/managed-agent-defaults', () => {
  beforeEach(() => {
    envState.MANAGED_AGENT_SELF_HOSTED_DEFAULTS = undefined
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'user_1' })
  })

  it('returns 401 for an unauthenticated caller', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const res = await GET(createMockRequest('GET'))
    expect(res.status).toBe(401)
  })

  it('returns an empty list when the env var is unset', async () => {
    const res = await GET(createMockRequest('GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.selfHosted).toEqual([])
  })

  it('returns an empty list for whitespace-only env values', async () => {
    envState.MANAGED_AGENT_SELF_HOSTED_DEFAULTS = '   '
    const body = await (await GET(createMockRequest('GET'))).json()
    expect(body.selfHosted).toEqual([])
  })

  it('returns an empty list on invalid JSON', async () => {
    envState.MANAGED_AGENT_SELF_HOSTED_DEFAULTS = '{not-json'
    const body = await (await GET(createMockRequest('GET'))).json()
    expect(body.selfHosted).toEqual([])
  })

  it('returns an empty list on a JSON array (must be an object)', async () => {
    envState.MANAGED_AGENT_SELF_HOSTED_DEFAULTS = '["a","b"]'
    const body = await (await GET(createMockRequest('GET'))).json()
    expect(body.selfHosted).toEqual([])
  })

  it('coerces a valid JSON object into table-row shape', async () => {
    envState.MANAGED_AGENT_SELF_HOSTED_DEFAULTS = JSON.stringify({
      FOO: 'bar',
      BAZ: 'qux',
    })
    const body = await (await GET(createMockRequest('GET'))).json()
    expect(body.selfHosted).toEqual([
      { cells: { Key: 'FOO', Value: 'bar' } },
      { cells: { Key: 'BAZ', Value: 'qux' } },
    ])
  })

  it('drops entries with a blank key', async () => {
    envState.MANAGED_AGENT_SELF_HOSTED_DEFAULTS = JSON.stringify({
      '': 'dropped',
      '   ': 'also dropped',
      keep: 'yes',
    })
    const body = await (await GET(createMockRequest('GET'))).json()
    expect(body.selfHosted).toEqual([{ cells: { Key: 'keep', Value: 'yes' } }])
  })

  it('coerces non-string values to their string form', async () => {
    envState.MANAGED_AGENT_SELF_HOSTED_DEFAULTS = JSON.stringify({
      A: 1,
      B: true,
      C: null,
    })
    const body = await (await GET(createMockRequest('GET'))).json()
    expect(body.selfHosted).toEqual([
      { cells: { Key: 'A', Value: '1' } },
      { cells: { Key: 'B', Value: 'true' } },
      { cells: { Key: 'C', Value: '' } },
    ])
  })
})
