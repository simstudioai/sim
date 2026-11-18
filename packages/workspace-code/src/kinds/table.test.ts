import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fingerprintOf } from '../fingerprint'
import type { TableColumnDecl, TableDecl } from './table'
import { testTableCodec } from './table.test-helpers'

const name = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,20}$/)
const text = fc.string({ maxLength: 40 }).filter((value) => !/[\u0000\ud800-\udfff]/.test(value))

const column: fc.Arbitrary<TableColumnDecl> = fc.oneof(
  fc.record(
    {
      type: fc.constantFrom('string', 'number', 'boolean', 'date', 'ttl', 'json') as fc.Arbitrary<
        TableColumnDecl['type']
      >,
      name,
      required: fc.boolean(),
      unique: fc.boolean(),
    },
    { requiredKeys: ['type'] }
  ),
  fc.record(
    {
      type: fc.constant('select' as const),
      options: fc.uniqueArray(
        text.filter((value) => value.length > 0),
        { minLength: 1, maxLength: 4, selector: (value) => value.toLowerCase() }
      ),
      multiple: fc.boolean(),
      required: fc.boolean(),
    },
    { requiredKeys: ['type', 'options'] }
  ),
  fc.record(
    { type: fc.constant('currency' as const), currencyCode: fc.constantFrom('USD', 'EUR') },
    { requiredKeys: ['type'] }
  )
)

const table: fc.Arbitrary<TableDecl> = fc.record(
  {
    name,
    description: text,
    folder: text.map((value) => `/${value}`),
    columns: fc
      .uniqueArray(fc.tuple(name, column), {
        minLength: 1,
        maxLength: 6,
        selector: ([key, value]) => (value.name ?? key).toLowerCase(),
      })
      .filter((entries) => {
        const keys = entries.map(([key]) => key.toLowerCase())
        const ttl = entries.filter(([, value]) => value.type === 'ttl').length
        return new Set(keys).size === keys.length && ttl <= 1
      })
      .map((entries) => Object.fromEntries(entries)),
  },
  { requiredKeys: ['name', 'columns'] }
)

function roundTrip(decl: TableDecl) {
  const printed = testTableCodec.print('leads', decl)
  return testTableCodec.parse('leads', printed.text, [])
}

describe('createTableCodec', () => {
  it('reads back every declaration it prints, byte-stable', () => {
    fc.assert(
      fc.property(table, (decl) => {
        const parsed = roundTrip(decl)
        expect(parsed.diagnostics).toEqual([])
        expect(parsed.decl).toEqual(decl)
        const decl2 = parsed.decl
        if (decl2)
          expect(testTableCodec.print('leads', decl2)).toEqual(testTableCodec.print('leads', decl))
      }),
      { numRuns: 300 }
    )
  })

  it('fingerprints ignore column order and spelled-out defaults', () => {
    const a: TableDecl = {
      name: 'leads',
      columns: { email: { type: 'string', required: false }, score: { type: 'number' } },
    }
    const b: TableDecl = {
      name: 'leads',
      columns: { score: { type: 'number' }, email: { type: 'string' } },
    }
    expect(fingerprintOf(testTableCodec.canonical(a))).toBe(
      fingerprintOf(testTableCodec.canonical(b))
    )
  })

  it('fingerprints an empty description as no description, as the server stores it', () => {
    const columns = { email: { type: 'string' as const } }
    expect(
      fingerprintOf(testTableCodec.canonical({ name: 'leads', description: '', columns }))
    ).toBe(fingerprintOf(testTableCodec.canonical({ name: 'leads', columns })))
  })

  it('pins a bad column to its line and names the supported fields', () => {
    const file = [
      '// @sim-sdk 1',
      "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
      '',
      'export default defineTable({',
      "  name: 'leads',",
      '  columns: {',
      '    email: column.string({ requird: true }),',
      "    status: column.select({ options: ['a', 'a'] }),",
      "    'bad name': column.string(),",
      '  },',
      '})',
      '',
    ].join('\n')
    const parsed = testTableCodec.parse('leads', { 'tables/leads.ts': file }, [])
    expect(parsed.decl).toBeUndefined()
    expect(
      parsed.diagnostics.map((finding) => [finding.code, finding.span?.line, finding.key])
    ).toEqual([
      ['E_DECL_UNKNOWN_FIELD', 7, 'leads'],
      ['E_TABLE_OPTIONS', 8, 'leads'],
      ['E_TABLE_COLUMN_NAME', 9, 'leads'],
    ])
    expect(parsed.diagnostics[0]?.hint).toContain('required')
  })

  it('refuses a unique select column and a second ttl column, pinned to their lines', () => {
    const file = [
      '// @sim-sdk 1',
      "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
      '',
      'export default defineTable({',
      "  name: 'leads',",
      '  columns: {',
      "    status: column.select({ options: ['a'], unique: true }),",
      '    expires_at: column.ttl(),',
      '    purge_at: column.ttl(),',
      '  },',
      '})',
      '',
    ].join('\n')
    const parsed = testTableCodec.parse('leads', { 'tables/leads.ts': file }, [])
    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics.map((finding) => [finding.code, finding.span?.line])).toEqual([
      ['E_DECL_SHAPE', 7],
      ['E_DECL_SHAPE', 9],
    ])
  })

  it('refuses what the server refuses: options repeated in another case, more than 100 options, an unknown currency', () => {
    const many = Array.from({ length: 101 }, (_, index) => `'o${index}'`).join(', ')
    const file = [
      '// @sim-sdk 1',
      "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
      '',
      'export default defineTable({',
      "  name: 'leads',",
      '  columns: {',
      "    status: column.select({ options: ['Open', 'open'] }),",
      `    tier: column.select({ options: [${many}] }),`,
      "    price: column.currency({ currencyCode: 'ZZZ' }),",
      "    cost: column.currency({ currencyCode: 'EUR' }),",
      '  },',
      '})',
      '',
    ].join('\n')
    const parsed = testTableCodec.parse('leads', { 'tables/leads.ts': file }, [])
    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics.map((finding) => [finding.code, finding.span?.line])).toEqual([
      ['E_TABLE_OPTIONS', 7],
      ['E_TABLE_OPTIONS', 8],
      ['E_DECL_SHAPE', 9],
    ])
  })

  it('reads a currency code in any letter case as the upper-case code the server stores', () => {
    const file = [
      '// @sim-sdk 1',
      "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
      '',
      'export default defineTable({',
      "  name: 'leads',",
      "  columns: { price: column.currency({ currencyCode: 'eur' }) },",
      '})',
      '',
    ].join('\n')
    const parsed = testTableCodec.parse('leads', { 'tables/leads.ts': file }, [])
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.decl?.columns.price).toEqual({ type: 'currency', currencyCode: 'EUR' })
  })

  it('groups one file per key and refuses anything else in tables/', () => {
    const grouped = testTableCodec.group(['tables/leads.ts', 'tables/Bad.ts', 'tables/x/y.ts'])
    expect([...grouped.groups.keys()]).toEqual(['leads'])
    expect(grouped.diagnostics.map((finding) => finding.code)).toEqual([
      'E_KEY_INVALID',
      'E_DECL_UNKNOWN_FILE',
    ])
  })
})
