/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { moreUsableAccount } from '@/lib/credential-groups/account-rules'

const row = (status: string | null) => ({ status })
const pick = (...statuses: Array<string | null>) =>
  statuses
    .map(row)
    .reduce<ReturnType<typeof row> | undefined>(
      (best, candidate) => moreUsableAccount(best, candidate, (account) => account.status),
      undefined
    )?.status

describe('choosing which of several accounts represents a connection', () => {
  it.each([
    [['revoked', 'active'], 'active'],
    [['active', 'revoked'], 'active'],
    [['revoked', 'needs_reauth'], 'needs_reauth'],
    [['needs_reauth', 'revoked'], 'needs_reauth'],
    [['needs_reauth', 'active', 'revoked'], 'active'],
    [[null, 'revoked'], null],
  ])('%j resolves to %s', (statuses, expected) => {
    expect(pick(...statuses)).toBe(expected)
  })
})
