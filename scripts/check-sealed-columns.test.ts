import { describe, expect, it } from 'vitest'
import { findViolations, readSealedColumns } from './check-sealed-columns'

const SCHEMA = `
export const account = pgTable(
  'account',
  {
    accessToken: sealedText('account', 'access_token'),
    refreshToken: sealedText('acount', 'refresh_token'),
  }
)
`

describe('check-sealed-columns', () => {
  it('rejects a sealed column whose context names another table', () => {
    const { columns, violations } = readSealedColumns(SCHEMA)
    expect(columns.map((column) => column.reference)).toEqual([
      'account.accessToken',
      'account.refreshToken',
    ])
    expect(violations).toMatchObject([{ rule: 'context-mismatch', line: 6 }])
  })

  it('follows a renamed import of the table', () => {
    const { columns } = readSealedColumns(SCHEMA)
    const source = [
      "import { account as accountTable, user } from '@sim/db/schema'",
      'where(eq(accountTable.refreshToken, token))',
    ].join('\n')
    expect(findViolations('file.ts', source, columns)).toMatchObject([
      { rule: 'comparison', line: 2 },
    ])
  })

  it('flags comparisons and raw interpolations but not the sealed helper', () => {
    const { columns } = readSealedColumns(SCHEMA)
    const source = [
      'where(eq(account.refreshToken, token))',
      'where(inArray(schema.account.accessToken, tokens))',
      `sql\`\${account.accessToken} IS NOT NULL\``,
      'where(sealedTextEquals(account.refreshToken, token))',
      'select({ accessToken: account.accessToken })',
    ].join('\n')
    const found = findViolations('file.ts', source, columns)
    expect(
      found.map(({ rule, line }) => [rule, line]).sort(([, a], [, b]) => Number(a) - Number(b))
    ).toEqual([
      ['comparison', 1],
      ['comparison', 2],
      ['raw-interpolation', 3],
    ])
  })
})
