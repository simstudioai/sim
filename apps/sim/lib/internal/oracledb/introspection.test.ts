/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  executeOracleStatements: vi.fn(),
}))

vi.mock('@/lib/internal/oracledb/client', () => clientMocks)

import {
  executeOracleIntrospect,
  oracleIntrospectionInternals,
} from '@/lib/internal/oracledb/introspection'

const CONNECTION = {
  host: 'db.example.com',
  port: 1521,
  protocol: 'tcp',
  connectionType: 'serviceName',
  serviceName: 'FREEPDB1',
  username: 'application',
  password: 'secret',
  connectionTimeout: 15000,
} as const

describe('Oracle Database introspection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('formats dimensions for common Oracle column types', () => {
    expect(
      oracleIntrospectionInternals.formatOracleType({
        DATA_TYPE: 'NUMBER',
        DATA_LENGTH: '22',
        CHAR_LENGTH: '0',
        CHAR_USED: null,
        DATA_PRECISION: '12',
        DATA_SCALE: '2',
      })
    ).toBe('NUMBER(12,2)')
    expect(
      oracleIntrospectionInternals.formatOracleType({
        DATA_TYPE: 'VARCHAR2',
        DATA_LENGTH: '120',
        CHAR_LENGTH: '30',
        CHAR_USED: 'C',
        DATA_PRECISION: null,
        DATA_SCALE: null,
      })
    ).toBe('VARCHAR2(30 CHAR)')
    expect(
      oracleIntrospectionInternals.formatOracleType({
        DATA_TYPE: 'VARCHAR2',
        DATA_LENGTH: '120',
        CHAR_LENGTH: '120',
        CHAR_USED: 'B',
        DATA_PRECISION: null,
        DATA_SCALE: null,
      })
    ).toBe('VARCHAR2(120 BYTE)')
    expect(
      oracleIntrospectionInternals.formatOracleType({
        DATA_TYPE: 'TIMESTAMP WITH TIME ZONE',
        DATA_LENGTH: '13',
        CHAR_LENGTH: '0',
        CHAR_USED: null,
        DATA_PRECISION: null,
        DATA_SCALE: '6',
      })
    ).toBe('TIMESTAMP(6) WITH TIME ZONE')
  })

  it('groups set-based dictionary rows into the established database shape', async () => {
    clientMocks.executeOracleStatements.mockResolvedValue([
      { rows: [{ SCHEMA_NAME: 'AppSchema' }], rowCount: 1 },
      {
        rows: [{ SCHEMA_NAME: 'AppSchema' }, { SCHEMA_NAME: 'CORE' }],
        rowCount: 2,
      },
      {
        rows: [{ TABLE_SCHEMA: 'AppSchema', TABLE_NAME: 'ChildItems' }],
        rowCount: 1,
      },
      {
        rows: [
          {
            TABLE_SCHEMA: 'AppSchema',
            TABLE_NAME: 'ChildItems',
            COLUMN_NAME: 'PartId',
            DATA_TYPE: 'NUMBER',
            DATA_LENGTH: '22',
            CHAR_LENGTH: '0',
            CHAR_USED: null,
            DATA_PRECISION: '10',
            DATA_SCALE: '0',
            NULLABLE: 'N',
            DATA_DEFAULT: null,
          },
          {
            TABLE_SCHEMA: 'AppSchema',
            TABLE_NAME: 'ChildItems',
            COLUMN_NAME: 'LineId',
            DATA_TYPE: 'NUMBER',
            DATA_LENGTH: '22',
            CHAR_LENGTH: '0',
            CHAR_USED: null,
            DATA_PRECISION: '10',
            DATA_SCALE: '0',
            NULLABLE: 'N',
            DATA_DEFAULT: null,
          },
          {
            TABLE_SCHEMA: 'AppSchema',
            TABLE_NAME: 'ChildItems',
            COLUMN_NAME: 'ParentId',
            DATA_TYPE: 'NUMBER',
            DATA_LENGTH: '22',
            CHAR_LENGTH: '0',
            CHAR_USED: null,
            DATA_PRECISION: '10',
            DATA_SCALE: '0',
            NULLABLE: 'Y',
            DATA_DEFAULT: null,
          },
        ],
        rowCount: 3,
      },
      {
        rows: [
          { TABLE_SCHEMA: 'AppSchema', TABLE_NAME: 'ChildItems', COLUMN_NAME: 'PartId' },
          { TABLE_SCHEMA: 'AppSchema', TABLE_NAME: 'ChildItems', COLUMN_NAME: 'LineId' },
        ],
        rowCount: 2,
      },
      {
        rows: [
          {
            TABLE_SCHEMA: 'AppSchema',
            TABLE_NAME: 'ChildItems',
            COLUMN_NAME: 'ParentId',
            REFERENCED_SCHEMA: 'CORE',
            REFERENCED_TABLE: 'ParentRecords',
            REFERENCED_COLUMN: 'RecordId',
          },
        ],
        rowCount: 1,
      },
      {
        rows: [
          {
            TABLE_SCHEMA: 'AppSchema',
            TABLE_NAME: 'ChildItems',
            INDEX_NAME: 'ChildParentIdx',
            UNIQUENESS: 'UNIQUE',
            COLUMN_NAME: 'ParentId',
          },
          {
            TABLE_SCHEMA: 'AppSchema',
            TABLE_NAME: 'ChildItems',
            INDEX_NAME: 'ChildParentIdx',
            UNIQUENESS: 'UNIQUE',
            COLUMN_NAME: 'LineId',
          },
        ],
        rowCount: 2,
      },
    ])

    const result = await executeOracleIntrospect(CONNECTION, {})

    expect(result).toMatchObject({
      schema: 'AppSchema',
      schemas: ['AppSchema', 'CORE'],
      truncated: false,
    })
    expect(result.tables[0]).toEqual({
      name: 'ChildItems',
      schema: 'AppSchema',
      columns: [
        {
          name: 'PartId',
          type: 'NUMBER(10,0)',
          nullable: false,
          default: null,
          isPrimaryKey: true,
          isForeignKey: false,
        },
        {
          name: 'LineId',
          type: 'NUMBER(10,0)',
          nullable: false,
          default: null,
          isPrimaryKey: true,
          isForeignKey: false,
        },
        {
          name: 'ParentId',
          type: 'NUMBER(10,0)',
          nullable: true,
          default: null,
          isPrimaryKey: false,
          isForeignKey: true,
          references: { schema: 'CORE', table: 'ParentRecords', column: 'RecordId' },
        },
      ],
      primaryKey: ['PartId', 'LineId'],
      foreignKeys: [
        {
          column: 'ParentId',
          referencesSchema: 'CORE',
          referencesTable: 'ParentRecords',
          referencesColumn: 'RecordId',
        },
      ],
      indexes: [{ name: 'ChildParentIdx', columns: ['ParentId', 'LineId'], unique: true }],
    })
    expect(clientMocks.executeOracleStatements.mock.calls[0][1]).toHaveLength(7)
  })

  it('slices 1001 visible tables to the exact table cap and reports truncation', async () => {
    const tableRows = Array.from({ length: 1_001 }, (_, index) => ({
      TABLE_SCHEMA: 'APP',
      TABLE_NAME: `TABLE_${String(index).padStart(4, '0')}`,
    }))
    clientMocks.executeOracleStatements.mockResolvedValue([
      { rows: [{ SCHEMA_NAME: 'APP' }], rowCount: 1 },
      { rows: [{ SCHEMA_NAME: 'APP' }], rowCount: 1 },
      { rows: tableRows, rowCount: tableRows.length },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ])

    const result = await executeOracleIntrospect(CONNECTION, {})

    expect(result.tables).toHaveLength(1_000)
    expect(result.tables.at(0)?.name).toBe('TABLE_0000')
    expect(result.tables.at(-1)?.name).toBe('TABLE_0999')
    expect(result.truncated).toBe(true)
  })

  it('slices 10001 visible columns to the exact column cap and reports truncation', async () => {
    const columnRows = Array.from({ length: 10_001 }, (_, index) => ({
      TABLE_SCHEMA: 'APP',
      TABLE_NAME: 'WIDE_TABLE',
      COLUMN_NAME: `COLUMN_${String(index).padStart(5, '0')}`,
      DATA_TYPE: 'NUMBER',
      DATA_LENGTH: '22',
      CHAR_LENGTH: '0',
      CHAR_USED: null,
      DATA_PRECISION: null,
      DATA_SCALE: null,
      NULLABLE: 'Y',
      DATA_DEFAULT: null,
    }))
    clientMocks.executeOracleStatements.mockResolvedValue([
      { rows: [{ SCHEMA_NAME: 'APP' }], rowCount: 1 },
      { rows: [{ SCHEMA_NAME: 'APP' }], rowCount: 1 },
      { rows: [{ TABLE_SCHEMA: 'APP', TABLE_NAME: 'WIDE_TABLE' }], rowCount: 1 },
      { rows: columnRows, rowCount: columnRows.length },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ])

    const result = await executeOracleIntrospect(CONNECTION, {})

    expect(result.tables).toHaveLength(1)
    expect(result.tables[0].columns).toHaveLength(10_000)
    expect(result.tables[0].columns.at(0)?.name).toBe('COLUMN_00000')
    expect(result.tables[0].columns.at(-1)?.name).toBe('COLUMN_09999')
    expect(result.truncated).toBe(true)
  })

  it('ignores partial metadata for inaccessible tables without failing visible results', async () => {
    clientMocks.executeOracleStatements.mockResolvedValue([
      { rows: [{ SCHEMA_NAME: 'APP' }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [{ TABLE_SCHEMA: 'APP', TABLE_NAME: 'VISIBLE_TABLE' }], rowCount: 1 },
      {
        rows: [
          {
            TABLE_SCHEMA: 'APP',
            TABLE_NAME: 'VISIBLE_TABLE',
            COLUMN_NAME: 'VISIBLE_ID',
            DATA_TYPE: 'NUMBER',
            DATA_LENGTH: '22',
            CHAR_LENGTH: '0',
            CHAR_USED: null,
            DATA_PRECISION: null,
            DATA_SCALE: null,
            NULLABLE: 'N',
            DATA_DEFAULT: null,
          },
          { TABLE_SCHEMA: 'APP', TABLE_NAME: 'INACCESSIBLE_TABLE' },
        ],
        rowCount: 2,
      },
      {
        rows: [{ TABLE_SCHEMA: 'APP', TABLE_NAME: 'INACCESSIBLE_TABLE' }],
        rowCount: 1,
      },
      {
        rows: [{ TABLE_SCHEMA: 'APP', TABLE_NAME: 'INACCESSIBLE_TABLE' }],
        rowCount: 1,
      },
      {
        rows: [{ TABLE_SCHEMA: 'APP', TABLE_NAME: 'INACCESSIBLE_TABLE' }],
        rowCount: 1,
      },
    ])

    const result = await executeOracleIntrospect(CONNECTION, {})

    expect(result).toMatchObject({ schemas: ['APP'], schema: 'APP', truncated: false })
    expect(result.tables).toEqual([
      {
        name: 'VISIBLE_TABLE',
        schema: 'APP',
        columns: [
          {
            name: 'VISIBLE_ID',
            type: 'NUMBER',
            nullable: false,
            default: null,
            isPrimaryKey: false,
            isForeignKey: false,
          },
        ],
        primaryKey: [],
        foreignKeys: [],
        indexes: [],
      },
    ])
  })

  it('drops an oversized first table instead of emitting an oversized response', () => {
    const result = oracleIntrospectionInternals.capFinalTables(
      [
        {
          name: 'LARGE_TABLE',
          schema: 'APP',
          columns: [
            {
              name: 'VALUE',
              type: `VARCHAR2(${`x`.repeat(11 * 1024 * 1024)})`,
              nullable: true,
              default: null,
              isPrimaryKey: false,
              isForeignKey: false,
            },
          ],
          primaryKey: [],
          foreignKeys: [],
          indexes: [],
        },
      ],
      ['APP']
    )

    expect(result).toEqual({ tables: [], truncated: true })
  })

  it('limits column metadata to selected base tables before FETCH', () => {
    expect(oracleIntrospectionInternals.INTROSPECTION_SQL.columns).toContain('JOIN ALL_TABLES')
    expect(oracleIntrospectionInternals.INTROSPECTION_SQL.columns).toContain("tables.NESTED = 'NO'")
    expect(oracleIntrospectionInternals.INTROSPECTION_SQL.columns).not.toContain(
      'cols.DATA_DEFAULT AS'
    )
    expect(oracleIntrospectionInternals.INTROSPECTION_SQL.columns).toContain(
      'CAST(NULL AS VARCHAR2(1)) AS "DATA_DEFAULT"'
    )
    expect(oracleIntrospectionInternals.INTROSPECTION_SQL.indexes).not.toContain(
      "i.STATUS = 'VALID'"
    )
  })

  it('keeps the selected schema inside the bounded visible-owner list', () => {
    const rows = Array.from({ length: 1_000 }, (_, index) => ({
      SCHEMA_NAME: `A_${String(index).padStart(4, '0')}`,
    }))

    const schemas = oracleIntrospectionInternals.boundedSchemas(rows, 'ZZZ_SELECTED')

    expect(schemas).toHaveLength(1_000)
    expect(schemas).toContain('ZZZ_SELECTED')
    expect(schemas).not.toContain('A_0999')
    expect(oracleIntrospectionInternals.INTROSPECTION_SQL.schemas).not.toContain(
      "OWNER NOT IN ('SYS', 'SYSTEM')"
    )
  })

  it('binds current versus explicit schema and preserves exact dictionary caps', () => {
    const current = oracleIntrospectionInternals.introspectionStatements(null)
    const explicit = oracleIntrospectionInternals.introspectionStatements('MixedSchema')

    expect(current[2].binds).toEqual({ schemaName: null })
    expect(explicit[2].binds).toEqual({ schemaName: 'MixedSchema' })
    expect(current.map((statement) => statement.maxRows)).toEqual([
      1, 1_001, 1_001, 10_001, 10_001, 10_001, 10_001,
    ])
  })
})
