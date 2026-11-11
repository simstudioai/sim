import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createWorkspaceKey } = vi.hoisted(() => ({ createWorkspaceKey: vi.fn() }))
vi.mock('@/lib/api-key/auth', () => ({
  createApiKey: vi.fn(),
  createWorkspaceApiKey: createWorkspaceKey,
}))

import {
  performCreatePersonalApiKey,
  performCreateWorkspaceApiKey,
} from '@/lib/api-key/orchestration'

const INTERNAL_DETAIL = 'connect ECONNREFUSED 10.0.0.5:5432 for role app'

describe('API key creation failures', () => {
  beforeEach(() => {
    resetDbChainMock()
    createWorkspaceKey.mockReset()
  })

  it('never echoes an internal personal-key failure to the caller', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error(INTERNAL_DETAIL))

    const result = await performCreatePersonalApiKey({ userId: 'user-1', name: 'CLI' })

    expect(result).toMatchObject({ success: false, errorCode: 'internal' })
    expect(result.error).not.toContain('ECONNREFUSED')
  })

  it('never echoes an internal workspace-key failure, but still names a conflict', async () => {
    createWorkspaceKey.mockRejectedValueOnce(new Error(INTERNAL_DETAIL))
    const internal = await performCreateWorkspaceApiKey({
      workspaceId: 'ws-1',
      userId: 'user-1',
      name: 'CLI',
    })
    expect(internal).toMatchObject({ success: false, errorCode: 'internal' })
    expect(internal.error).not.toContain('ECONNREFUSED')

    createWorkspaceKey.mockRejectedValueOnce(new Error('A key named "CLI" already exists'))
    const conflict = await performCreateWorkspaceApiKey({
      workspaceId: 'ws-1',
      userId: 'user-1',
      name: 'CLI',
    })
    expect(conflict).toEqual({
      success: false,
      errorCode: 'conflict',
      error: 'A key named "CLI" already exists',
    })
  })
})
