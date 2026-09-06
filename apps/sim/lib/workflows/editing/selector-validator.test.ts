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

import { validateSelectorIds } from '@/lib/workflows/editing/selector-validator'

describe('validateSelectorIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockCheckWorkspaceAccess.mockResolvedValue({ canAdmin: false })
  })

  it.each([
    'oauth-input',
    'knowledge-base-selector',
    'workflow-selector',
    'document-selector',
    'mcp-server-selector',
  ])(
    'propagates an unavailable %s lookup for a complete diagnostic, preserving advisory validation',
    async (selectorType) => {
      const context = { userId: 'user-1', workspaceId: 'workspace-1' }
      dbChainMockFns.where.mockRejectedValueOnce(new Error('lookup unavailable'))
      await expect(
        validateSelectorIds(selectorType, 'resource-1', context, { requireComplete: true })
      ).rejects.toThrow('lookup unavailable')
      dbChainMockFns.where.mockRejectedValueOnce(new Error('lookup unavailable'))
      await expect(validateSelectorIds(selectorType, 'resource-1', context)).resolves.toEqual({
        valid: ['resource-1'],
        invalid: [],
        warning: `Failed to validate ${selectorType} IDs - validation skipped`,
      })
    }
  )

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

  /**
   * The mocked `where` hands back the row whatever predicate it is given, so
   * the returned value proves nothing on its own. What has to be asserted is
   * the predicate: the admin branch drops the credential-membership clause,
   * and the member branch keeps it.
   */
  it('lets a derived workspace admin reference shared credentials without membership', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({ canAdmin: true })
    dbChainMockFns.where.mockResolvedValueOnce([{ credentialId: 'shared-cred', accountId: null }])

    const result = await validateSelectorIds('oauth-input', ['shared-cred'], {
      userId: 'admin-user',
      workspaceId: 'workspace-1',
    })

    expect(result).toEqual({ valid: ['shared-cred'], invalid: [] })
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    expect(membershipClauseOf(dbChainMockFns.where.mock.calls[0][0])).toBeUndefined()
  })

  it('still requires credential membership for a non-admin member', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([{ credentialId: 'shared-cred', accountId: null }])

    await validateSelectorIds('oauth-input', ['shared-cred'], {
      userId: 'member-user',
      workspaceId: 'workspace-1',
    })

    expect(membershipClauseOf(dbChainMockFns.where.mock.calls[0][0])).toMatchObject({
      type: 'isNotNull',
    })
  })
})

/**
 * The second argument of the outer `and(...)` the query is filtered by. The
 * mocked drizzle helpers record their arguments verbatim, so the membership
 * clause is either an `isNotNull` node or `undefined`.
 */
function membershipClauseOf(predicate: unknown): unknown {
  const node = predicate as { type?: string; args?: unknown[] }
  expect(node.type).toBe('and')
  return node.args?.[1]
}
