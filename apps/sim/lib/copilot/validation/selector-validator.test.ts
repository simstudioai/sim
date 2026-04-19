/**
 * @vitest-environment node
 */
import { schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  inArray: vi.fn((...args: unknown[]) => ({ type: 'inArray', args })),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
  or: vi.fn((...args: unknown[]) => ({ type: 'or', args })),
}))

import { validateSelectorIds } from './selector-validator'

function createSelectChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    from: vi.fn().mockReturnValue(chain),
    innerJoin: vi.fn().mockReturnValue(chain),
    leftJoin: vi.fn().mockReturnValue(chain),
    where: vi.fn().mockResolvedValue(result),
  })
  return chain
}

describe('validateSelectorIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts shared workspace credential ids and legacy account ids for oauth-input', async () => {
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([{ credentialId: 'cred-1', accountId: 'acct-1' }])
    )

    const result = await validateSelectorIds('oauth-input', ['cred-1', 'acct-1'], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result).toEqual({
      valid: ['cred-1', 'acct-1'],
      invalid: [],
    })
    expect(mockDbSelect).toHaveBeenCalledTimes(1)
  })

  it('reports accessible workspace credentials in warnings for invalid oauth-input ids', async () => {
    mockDbSelect.mockReturnValueOnce(createSelectChain([])).mockReturnValueOnce(
      createSelectChain([
        {
          id: 'cred-2',
          displayName: 'Shared Gmail',
          accountId: 'acct-2',
          credentialProviderId: null,
          accountProviderId: 'google-email',
        },
      ])
    )

    const result = await validateSelectorIds('oauth-input', 'missing-cred', {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result.valid).toEqual([])
    expect(result.invalid).toEqual(['missing-cred'])
    expect(result.warning).toContain('Accessible workspace credentials:')
    expect(result.warning).toContain('Shared Gmail [cred-2]')
  })
})
