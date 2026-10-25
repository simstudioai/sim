import { describe, expect, it } from 'vitest'
import { findViolations, readSealedColumns } from './check-sealed-columns'

const COLUMNS = readSealedColumns(`
export const account = pgTable(
  'account',
  {
    accessToken: sealedText('account', 'access_token'),
    refreshToken: sealedText('account', 'refresh_token'),
  }
)
`)

function found(source: string, file = 'lib/file.ts') {
  return findViolations(file, source, COLUMNS)
    .map(({ rule, line }) => [rule, line])
    .sort(([, a], [, b]) => Number(a) - Number(b))
}

describe('check-sealed-columns', () => {
  it('reads every sealed column with its physical name', () => {
    expect(COLUMNS).toMatchObject([
      { reference: 'account.accessToken', columnName: 'access_token' },
      { reference: 'account.refreshToken', columnName: 'refresh_token' },
    ])
  })

  it('flags comparison operators and raw interpolations but not the sealed helper', () => {
    const source = [
      'where(eq(account.refreshToken, token))',
      'where(inArray(schema.account.accessToken, tokens))',
      `sql\`\${account.accessToken} IS NOT NULL\``,
      'where(like(account.accessToken, prefix))',
      'where(gte(account.refreshToken, token))',
      'where(sealedTextEquals(account.refreshToken, token))',
      'where(isNotNull(account.refreshToken))',
      'select({ accessToken: account.accessToken })',
    ].join('\n')
    expect(found(source)).toEqual([
      ['comparison', 1],
      ['comparison', 2],
      ['raw-interpolation', 3],
      ['comparison', 4],
      ['comparison', 5],
    ])
  })

  it('follows renamed imports and alias() bindings of the table', () => {
    const source = [
      "import { account as accountTable, user } from '@sim/db/schema'",
      'where(eq(accountTable.refreshToken, token))',
      "const sibling = alias(account, 'sibling')",
      'where(ne(sibling.accessToken, token))',
    ].join('\n')
    expect(found(source)).toEqual([
      ['comparison', 2],
      ['comparison', 4],
    ])
  })

  it('flags physical column names in raw SQL outside tests and the backfill', () => {
    const source = [
      `await db.execute(sql\`SELECT id FROM account WHERE id = \${id}\nAND access_token IS NULL\`)`,
      "sql.raw('refresh_token IS NULL')",
      `sql\`SELECT id FROM oauth_refresh_token WHERE grant = \${'refresh_token'}\``,
      "sql`SELECT * FROM account WHERE user_id = 'u'`",
      'sql`SELECT a.* FROM account_activity a`',
      "sql.identifier('refresh_token')",
    ].join('\n')
    expect(found(source)).toEqual([
      ['raw-column-name', 2],
      ['raw-column-name', 3],
      ['raw-column-name', 5],
      ['raw-column-name', 7],
    ])
    expect(found(source, 'lib/file.integration.ts')).toEqual([])
    expect(found(source, 'packages/db/script-migrations/0037_seal_account_tokens.ts')).toEqual([])
  })
})
