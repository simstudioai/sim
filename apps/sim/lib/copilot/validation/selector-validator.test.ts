/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckWorkspaceAccess } = vi.hoisted(() => ({
  mockCheckWorkspaceAccess: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  inArray: vi.fn((...args: unknown[]) => ({ type: 'inArray', args })),
  isNotNull: vi.fn((field: unknown) => ({ type: 'isNotNull', field })),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
  or: vi.fn((...args: unknown[]) => ({ type: 'or', args })),
}))

import { validateSelectorIds } from './selector-validator'

describe('validateSelectorIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockCheckWorkspaceAccess.mockResolvedValue({ canAdmin: false })
  })

  it('accepts shared workspace credential ids and legacy account ids for oauth-input', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([{ credentialId: 'cred-1', accountId: 'acct-1' }])

    const result = await validateSelectorIds('oauth-input', ['cred-1', 'acct-1'], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result).toEqual({
      valid: ['cred-1', 'acct-1'],
      invalid: [],
    })
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
  })

  it('reports accessible workspace credentials in warnings for invalid oauth-input ids', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'cred-2',
        displayName: 'Shared Gmail',
        accountId: 'acct-2',
        credentialProviderId: null,
        accountProviderId: 'google-email',
      },
    ])

    const result = await validateSelectorIds('oauth-input', 'missing-cred', {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result.valid).toEqual([])
    expect(result.invalid).toEqual(['missing-cred'])
    expect(result.warning).toContain('Accessible workspace credentials:')
    expect(result.warning).toContain('Shared Gmail [cred-2]')
  })

  it('lets a derived workspace admin reference shared credentials without membership', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({ canAdmin: true })
    dbChainMockFns.where.mockResolvedValueOnce([{ credentialId: 'shared-cred', accountId: null }])

    const result = await validateSelectorIds('oauth-input', ['shared-cred'], {
      userId: 'admin-user',
      workspaceId: 'workspace-1',
    })

    expect(result).toEqual({ valid: ['shared-cred'], invalid: [] })
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
  })
})
