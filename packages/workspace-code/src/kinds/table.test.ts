import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fingerprintOf } from '../fingerprint'
import { type TableColumnDecl, type TableDecl, tableCodec } from './table'

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
        { minLength: 1, maxLength: 4 }
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
        return new Set(keys).size === keys.length
      })
      .map((entries) => Object.fromEntries(entries)),
  },
  { requiredKeys: ['name', 'columns'] }
)

function roundTrip(decl: TableDecl) {
  const printed = tableCodec.print('leads', decl)
  return tableCodec.parse('leads', printed.text, [])
}

describe('tableCodec', () => {
  it('reads back every declaration it prints, byte-stable', () => {
    fc.assert(
      fc.property(table, (decl) => {
        const parsed = roundTrip(decl)
        expect(parsed.diagnostics).toEqual([])
        expect(parsed.decl).toEqual(decl)
        const decl2 = parsed.decl
        if (decl2) expect(tableCodec.print('leads', decl2)).toEqual(tableCodec.print('leads', decl))
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
    expect(fingerprintOf(tableCodec.canonical(a))).toBe(fingerprintOf(tableCodec.canonical(b)))
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
    const parsed = tableCodec.parse('leads', { 'tables/leads.ts': file }, [])
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

  it('groups one file per key and refuses anything else in tables/', () => {
    const grouped = tableCodec.group(['tables/leads.ts', 'tables/Bad.ts', 'tables/x/y.ts'])
    expect([...grouped.groups.keys()]).toEqual(['leads'])
    expect(grouped.diagnostics.map((finding) => finding.code)).toEqual([
      'E_KEY_INVALID',
      'E_DECL_UNKNOWN_FILE',
    ])
  })
})
