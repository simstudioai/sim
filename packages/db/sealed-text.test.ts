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
