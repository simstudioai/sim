import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { refusalClass } from '../diagnostics'
import { fingerprintOf } from '../fingerprint'
import { WORKSPACE_SOURCE_LIMITS } from '../limits'
import type { TableColumnDecl, TableDecl } from './table'
import { testTableCodec } from './table.test-helpers'
import { tableRowsFingerprint } from './table-rows'

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

  it('refuses a select over the option cap by the cap alone, in linear time', () => {
    const parse = (count: number) => {
      const options = Array.from({ length: count }, (_, index) => `'o${index}'`).join(',')
      const file = `// @sim-sdk 1\nimport { column, defineTable } from '@sim/workflow-sdk/workspace'\n\nexport default defineTable({ name: 'leads', columns: { tier: column.select({ options: [${options}] }) } })\n`
      return () => testTableCodec.parse('leads', { 'tables/leads.ts': file }, [])
    }
    expect(parse(20_000)().diagnostics).toMatchObject([
      { code: 'E_TABLE_OPTIONS', message: expect.stringContaining('20000 options') },
    ])
    expectLinearGrowth(parse, 5_000)
  })

  it('pins a duplicate column name to the second column, not the whole table', () => {
    const file = [
      '// @sim-sdk 1',
      "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
      '',
      'export default defineTable({',
      "  name: 'leads',",
      '  columns: {',
      '    Email: column.string(),',
      "    email: column.string({ name: 'EMAIL' }),",
      '  },',
      '})',
      '',
    ].join('\n')
    const parsed = testTableCodec.parse('leads', { 'tables/leads.ts': file }, [])
    expect(parsed.diagnostics).toMatchObject([
      { code: 'E_TABLE_DUPLICATE_COLUMN', span: { line: 8, endLine: 8 } },
    ])
  })

  it('refuses a helper call as the whole declaration with one finding, not its encoding', () => {
    const parsed = testTableCodec.parse(
      'leads',
      {
        'tables/leads.ts': `// @sim-sdk 1\nimport { column, defineTable } from '@sim/workflow-sdk/workspace'\n\nexport default defineTable(column.string())\n`,
      },
      []
    )
    expect(parsed.diagnostics).toMatchObject([
      {
        code: 'E_DECL_UNSUPPORTED',
        message: expect.stringContaining('defineTable takes an object'),
        span: { line: 4 },
      },
    ])
  })

  it('refuses two columns whose stored names differ only in letter case, and more columns than a table holds', () => {
    const table = (columns: string) =>
      testTableCodec.parse(
        'leads',
        {
          'tables/leads.ts': `// @sim-sdk 1\nimport { column, defineTable } from '@sim/workflow-sdk/workspace'\n\nexport default defineTable({ name: 'leads', columns: { ${columns} } })\n`,
        },
        []
      )
    const columns = (count: number) =>
      Array.from({ length: count }, (_, index) => `c${index}: column.string()`).join(', ')

    const cased = table("Email: column.string(), email: column.string({ name: 'EMAIL' })")
    expect(cased.diagnostics.map((finding) => finding.code)).toEqual(['E_TABLE_DUPLICATE_COLUMN'])
    expect(cased.decl).toBeUndefined()
    expect(table(columns(WORKSPACE_SOURCE_LIMITS.maxColumns)).diagnostics).toEqual([])
    expect(
      table(columns(WORKSPACE_SOURCE_LIMITS.maxColumns + 1)).diagnostics.map(
        (finding) => finding.code
      )
    ).toEqual(['E_TABLE_TOO_MANY_COLUMNS'])
    expect(refusalClass(['E_TABLE_TOO_MANY_COLUMNS'])).toBe('payload_too_large')
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

describe('table rows as source', () => {
  const columns: TableDecl['columns'] = {
    code: { type: 'string', required: true, unique: true },
    seats: { type: 'number' },
    tier: { type: 'select', options: ['basic', 'pro'] },
  }
  const declaration = (rows: string) =>
    [
      '// @sim-sdk 1',
      "import { column, defineTable } from '@sim/workflow-sdk/workspace'",
      '',
      'export default defineTable({',
      "  name: 'plans',",
      '  columns: {',
      '    code: column.string({ required: true, unique: true }),',
      '    seats: column.number(),',
      "    tier: column.select({ options: ['basic', 'pro'] }),",
      '  },',
      ...(rows ? [`  rows: ${rows},`] : []),
      '})',
      '',
    ].join('\n')
  const parse = (rows: string, file?: string) =>
    testTableCodec.parse(
      'plans',
      {
        'tables/plans.ts': declaration(rows),
        ...(file !== undefined ? { 'tables/plans.rows.jsonl': file } : {}),
      },
      []
    )
  const errors = (parsed: ReturnType<typeof parse>) =>
    parsed.diagnostics.map((finding) => [finding.code, finding.span?.line, finding.message])

  it('reads back managed rows it prints, sorted by key, byte-stable', () => {
    const decl: TableDecl = {
      name: 'plans',
      columns,
      rows: {
        mode: 'managed',
        key: 'code',
        data: [
          { code: 'team', seats: 10, tier: 'pro' },
          { code: 'solo', seats: 1 },
        ],
      },
    }
    const printed = testTableCodec.print('plans', decl)
    expect(printed.text['tables/plans.rows.jsonl']).toBe(
      '{"code":"solo","seats":1}\n{"code":"team","seats":10,"tier":"pro"}\n'
    )
    const parsed = testTableCodec.parse('plans', printed.text, [])
    expect(parsed.diagnostics).toEqual([])
    expect(testTableCodec.print('plans', parsed.decl as TableDecl)).toEqual(printed)
    expect(tableRowsFingerprint(parsed.decl?.rows)).toBe(tableRowsFingerprint(decl.rows))
  })

  it('keeps seed rows in file order and prints no rows file for no rows', () => {
    const parsed = parse("{ mode: 'seed' }", '{"code":"b"}\n\n{"code":"a"}\n')
    expect(parsed.decl?.rows).toEqual({ mode: 'seed', data: [{ code: 'b' }, { code: 'a' }] })
    const empty = parse("{ mode: 'managed', key: 'code' }")
    expect(empty.decl?.rows).toEqual({ mode: 'managed', key: 'code', data: [] })
    expect(Object.keys(testTableCodec.print('plans', empty.decl as TableDecl).text)).toEqual([
      'tables/plans.ts',
    ])
  })

  it('refuses a rows file the declaration does not opt into, and a mode or key it cannot use', () => {
    expect(errors(parse('', '{"code":"a"}\n')).map(([code]) => code)).toEqual(['E_TABLE_ROWS'])
    expect(errors(parse("{ mode: 'managed' }"))[0]?.[2]).toMatch(/need `key`/)
    expect(errors(parse("{ mode: 'managed', key: 'seats' }"))[0]?.[2]).toMatch(/not unique/)
    expect(errors(parse("{ mode: 'managed', key: 'owner' }"))[0]?.[2]).toMatch(/not a declared/)
    expect(errors(parse("{ mode: 'seed', key: 'code' }"))[0]?.[2]).toMatch(/take no `key`/)
    expect(errors(parse("{ mode: 'mirror' }"))[0]?.[2]).toMatch(/not a rows mode/)
  })

  it('pins each bad row to its line', () => {
    const file = [
      '{"code":"a"}',
      'not json',
      '[1]',
      '{"code":"b","owner":"x"}',
      '{"seats":2}',
      '{"code":"A"}',
    ].join('\n')
    expect(errors(parse("{ mode: 'managed', key: 'code' }", file))).toEqual([
      ['E_TABLE_ROWS', 2, 'Line 2 is not JSON.'],
      ['E_TABLE_ROWS', 3, 'Line 3 is not a JSON object.'],
      ['E_TABLE_ROWS', 4, 'Line 4 names "owner", which the table does not declare.'],
      ['E_TABLE_ROWS', 5, 'Line 5 has no "code": a managed row is matched by its key column.'],
      ['E_TABLE_ROWS', 6, 'Lines 1 and 6 share the key "A".'],
    ])
  })

  it(`refuses more than ${WORKSPACE_SOURCE_LIMITS.maxTableRows} rows`, () => {
    const file = Array.from(
      { length: WORKSPACE_SOURCE_LIMITS.maxTableRows + 1 },
      (_, index) => `{"code":"c${index}"}`
    ).join('\n')
    expect(errors(parse("{ mode: 'managed', key: 'code' }", file)).map(([code]) => code)).toEqual([
      'E_TABLE_ROWS',
    ])
  })

  it('fingerprints managed rows by content, ignoring order and empty cells', () => {
    const rows = (data: Array<Record<string, string | number | null>>) =>
      tableRowsFingerprint({ mode: 'managed', key: 'code', data })
    const a = rows([{ code: 'a', seats: 1 }, { code: 'b' }])
    expect(
      rows([
        { code: 'b', seats: null },
        { seats: 1, code: 'a' },
      ])
    ).toBe(a)
    expect(rows([{ code: 'a', seats: 2 }, { code: 'b' }])).not.toBe(a)
    expect(tableRowsFingerprint({ mode: 'seed', data: [{ code: 'a' }] })).toBeNull()
  })

  it('groups a rows file with its table and counts it against the rows budget', () => {
    const grouped = testTableCodec.group(['tables/plans.ts', 'tables/plans.rows.jsonl'])
    expect(grouped.groups.get('plans')).toEqual(['tables/plans.ts', 'tables/plans.rows.jsonl'])
    expect(testTableCodec.budgetOf?.('tables/plans.rows.jsonl')).toBe('rows')
    expect(testTableCodec.budgetOf?.('tables/plans.ts')).toBe('declaration')
  })
})
