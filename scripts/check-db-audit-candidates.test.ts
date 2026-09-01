import { describe, expect, it } from 'vitest'
import { mayReferencePendingTable } from './check-pending-drop-tables'
import { mayBindDrizzleSql } from './check-sql-date-binding'

describe('database audit candidate scans', () => {
  it('finds renamed pending-table imports', () => {
    expect(
      mayReferencePendingTable(
        "import { organization as org } from '@sim/db/schema'",
        new Set(['organization'])
      )
    ).toBe(true)
  })

  it('decodes escaped schema module literals', () => {
    expect(
      mayReferencePendingTable(
        String.raw`const organization = require('@sim/db/sch\u0065ma')`,
        new Set(['organization'])
      )
    ).toBe(true)
  })

  it('rejects unrelated uses of common table names', () => {
    expect(
      mayReferencePendingTable('const organization = getOrganization()', new Set(['organization']))
    ).toBe(false)
  })

  it('finds aliased drizzle sql imports', () => {
    expect(mayBindDrizzleSql("import { sql as query } from 'drizzle-orm'")).toBe(true)
  })

  it('finds drizzle sql subpath imports', () => {
    expect(mayBindDrizzleSql("import { sql } from 'drizzle-orm/sql'")).toBe(true)
  })

  it('decodes escaped drizzle module literals', () => {
    expect(mayBindDrizzleSql(String.raw`const { sql } = require('drizzle\x2dorm')`)).toBe(true)
  })

  it('skips drizzle consumers that cannot bind sql', () => {
    expect(mayBindDrizzleSql("import { eq } from 'drizzle-orm'")).toBe(false)
  })
})
