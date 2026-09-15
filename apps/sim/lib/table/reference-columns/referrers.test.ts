/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { findReferencingTables } from '@/lib/table/reference-columns/referrers'
import type { ColumnDefinition, TableSchema } from '@/lib/table/types'

function table(id: string, name: string, columns: ColumnDefinition[] = []) {
  return { id, name, schema: { columns } as TableSchema }
}

function reference(id: string, referenceTableId: string): ColumnDefinition {
  return { id, name: id, type: 'reference', referenceTableId }
}

describe('findReferencingTables', () => {
  it('returns surviving tables that reference a deleted table, sorted by name', () => {
    const tables = [
      table('tbl_accounts', 'Accounts'),
      table('tbl_orders', 'Orders', [reference('col_account', 'tbl_accounts')]),
      table('tbl_invoices', 'Invoices', [reference('col_account', 'tbl_accounts')]),
    ]

    expect(findReferencingTables(tables, new Set(['tbl_accounts']))).toEqual([
      { id: 'tbl_invoices', name: 'Invoices' },
      { id: 'tbl_orders', name: 'Orders' },
    ])
  })

  it('ignores referrers deleted in the same selection, including self-references', () => {
    const tables = [
      table('tbl_accounts', 'Accounts', [reference('col_parent', 'tbl_accounts')]),
      table('tbl_orders', 'Orders', [reference('col_account', 'tbl_accounts')]),
    ]

    expect(findReferencingTables(tables, new Set(['tbl_accounts', 'tbl_orders']))).toEqual([])
  })

  it('ignores other column types and references to surviving tables', () => {
    const tables = [
      table('tbl_accounts', 'Accounts'),
      table('tbl_companies', 'Companies'),
      table('tbl_orders', 'Orders', [
        { id: 'col_note', name: 'note', type: 'string' },
        reference('col_company', 'tbl_companies'),
      ]),
    ]

    expect(findReferencingTables(tables, new Set(['tbl_accounts']))).toEqual([])
  })

  it('returns nothing for an empty deletion', () => {
    const tables = [table('tbl_orders', 'Orders', [reference('col_account', 'tbl_accounts')])]

    expect(findReferencingTables(tables, new Set())).toEqual([])
  })
})
