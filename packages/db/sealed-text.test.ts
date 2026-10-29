import { account } from '@sim/db/schema'
import { sealedTextEquals } from '@sim/db/sealed-text'
import { alias, PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('sealedTextEquals', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', 'c'.repeat(64))
    vi.stubEnv('ENCRYPT_ACCOUNT_TOKENS', 'true')
  })

  it('matches the sealed form a write stores, through an alias of the table', () => {
    const stored = account.refreshToken.mapToDriverValue('refresh-token')
    const sibling = alias(account, 'sibling')

    const { params } = new PgDialect().sqlToQuery(
      sealedTextEquals(sibling.refreshToken, 'refresh-token')
    )
    expect(params).toEqual(['refresh-token', stored])
  })
})

describe('account token sealing without a usable ENCRYPTION_KEY', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('ENCRYPTION_KEY', 'z'.repeat(64))
    vi.stubEnv('ENCRYPT_ACCOUNT_TOKENS', undefined)
  })

  it('writes plaintext and warns once at startup with the reason, without failing', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { account: freshAccount } = await import('@sim/db/schema')
    const { reportAccountTokenSealing } = await import('@sim/db/sealed-text')

    reportAccountTokenSealing()
    expect(freshAccount.accessToken.mapToDriverValue('access-token')).toBe('access-token')
    reportAccountTokenSealing()

    const lines = output.mock.calls.map((call) => call.join(' '))
    const sealingLines = lines.filter((line) => line.includes('Account token sealing'))
    expect(sealingLines).toHaveLength(1)
    expect(sealingLines[0]).toContain('WARN')
    expect(sealingLines[0]).toContain(
      'Account token sealing: disabled (ENCRYPTION_KEY is not a 64-character hex key)'
    )
  })
})
