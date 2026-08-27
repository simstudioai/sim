/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildWithClause,
  renderColumnSchema,
  renderEntityName,
  renderIngestMode,
  renderOperationId,
  transformColumnListResponse,
} from '@/tools/azure_data_explorer/utils'

describe('renderEntityName', () => {
  it('leaves a plain identifier bare, as the reference commands are written', () => {
    expect(renderEntityName('StormEvents')).toBe('StormEvents')
    expect(renderEntityName('_internal_logs2')).toBe('_internal_logs2')
  })

  it('trims surrounding whitespace from a pasted name', () => {
    expect(renderEntityName('  StormEvents  ')).toBe('StormEvents')
  })

  it('quotes the identifier characters Kusto allows but cannot parse bare', () => {
    expect(renderEntityName('My Table')).toBe('["My Table"]')
    expect(renderEntityName('web-requests')).toBe('["web-requests"]')
    expect(renderEntityName('prod.logs')).toBe('["prod.logs"]')
    expect(renderEntityName('1day')).toBe('["1day"]')
  })
})

describe('buildWithClause', () => {
  it('returns nothing when no properties are given', () => {
    expect(buildWithClause(undefined, 'format="json"')).toBe('')
    expect(buildWithClause('   ', 'format="json"')).toBe('')
    expect(buildWithClause('with ()', 'format="json"')).toBe('')
  })

  it('builds the clause from bare name=value pairs', () => {
    expect(buildWithClause('format="json"', 'format="json"')).toBe(' with (format="json")')
    expect(
      buildWithClause('format="json", ingestionMappingReference="mymapping"', 'format="json"')
    ).toBe(' with (format="json", ingestionMappingReference="mymapping")')
  })

  it('accepts a clause the user already wrapped in with (...)', () => {
    expect(buildWithClause('with (format="csv")', 'format="json"')).toBe(' with (format="csv")')
  })

  it('accepts unquoted and numeric values', () => {
    expect(buildWithClause('ignoreFirstRecord=true', 'format="json"')).toBe(
      ' with (ignoreFirstRecord=true)'
    )
    expect(buildWithClause('creationTime=2024-01-01T00:00:00', 'format="json"')).toBe(
      ' with (creationTime=2024-01-01T00:00:00)'
    )
  })

  it('keeps a comma that sits inside a quoted value', () => {
    expect(buildWithClause('docstring="Raw logs, archived nightly"', 'format="json"')).toBe(
      ' with (docstring="Raw logs, archived nightly")'
    )
    expect(buildWithClause(`tags="['daily','prod']"`, 'format="json"')).toBe(
      ` with (tags="['daily','prod']")`
    )
  })

  it('still separates properties on the commas between them', () => {
    expect(
      buildWithClause('docstring="Logs, raw", folder="Ingest", distributed=true', 'format="json"')
    ).toBe(' with (docstring="Logs, raw", folder="Ingest", distributed=true)')
  })

  it('rejects an unterminated quote rather than swallowing the rest of the clause', () => {
    expect(() => buildWithClause('docstring="never closed', 'format="json"')).toThrow(
      /Unterminated " quote/
    )
  })

  it('accepts the exact multi-property clause the Kusto reference shows', () => {
    // .append OldExtents with(tags='["TagA","TagB"]', ingestIfNotExists='["myTag"]')
    expect(
      buildWithClause(`tags='["TagA","TagB"]', ingestIfNotExists='["myTag"]'`, 'distributed=true')
    ).toBe(` with (tags='["TagA","TagB"]', ingestIfNotExists='["myTag"]')`)
  })

  it('rejects a value that would close the clause and extend the command', () => {
    expect(() => buildWithClause('format="json") <| evil', 'format="json"')).toThrow(
      /Invalid property/
    )
  })

  it('rejects a property that is not a name=value pair', () => {
    expect(() => buildWithClause('drop table StormEvents', 'format="json"')).toThrow(
      /Invalid property/
    )
  })
})

describe('renderColumnSchema', () => {
  it('normalizes a CSL schema and lowercases the types', () => {
    expect(renderColumnSchema('Timestamp:DateTime, Level:string, Count:LONG')).toBe(
      'Timestamp:datetime, Level:string, Count:long'
    )
  })

  it('accepts every documented scalar type and alias', () => {
    expect(renderColumnSchema('a:bool, b:boolean, c:date, d:guid, e:uuid, f:double, g:time')).toBe(
      'a:bool, b:boolean, c:date, d:guid, e:uuid, f:double, g:time'
    )
  })

  it('quotes a column name that cannot be written bare', () => {
    expect(renderColumnSchema('Event Time:datetime')).toBe('["Event Time"]:datetime')
  })

  it('rejects a type Kusto does not define', () => {
    expect(() => renderColumnSchema('Amount:money')).toThrow(/Unknown column type "money"/)
  })

  it('rejects a column that is not a name:type pair', () => {
    expect(() => renderColumnSchema('Timestamp')).toThrow(/expected name:type pairs/)
  })

  it('rejects a schema that would close the column list and extend the command', () => {
    expect(() => renderColumnSchema('a:string) //')).toThrow(/Unknown column type/)
  })

  it('rejects an empty schema', () => {
    expect(() => renderColumnSchema('  ,  ')).toThrow(/Column schema is required/)
  })
})

describe('renderIngestMode', () => {
  it('defaults to the non-destructive set-or-append command', () => {
    expect(renderIngestMode(undefined)).toBe('.set-or-append')
    expect(renderIngestMode('')).toBe('.set-or-append')
  })

  it('maps each documented mode onto its command word', () => {
    expect(renderIngestMode('set')).toBe('.set')
    expect(renderIngestMode('append')).toBe('.append')
    expect(renderIngestMode('set-or-replace')).toBe('.set-or-replace')
  })

  it('rejects a mode that is not one of the four commands', () => {
    expect(() => renderIngestMode('drop')).toThrow(/Unknown ingest mode "drop"/)
  })
})

describe('renderOperationId', () => {
  it('accepts a GUID', () => {
    expect(renderOperationId(' 8f1e5c4a-1b2c-4d3e-9f80-0a1b2c3d4e5f ')).toBe(
      '8f1e5c4a-1b2c-4d3e-9f80-0a1b2c3d4e5f'
    )
  })

  it('rejects anything that could extend the command it lands in', () => {
    expect(() => renderOperationId('abc") | drop table X //')).toThrow(/Invalid operation ID/)
  })
})

/** Minimal stand-in for the proxy's JSON envelope. */
function proxyResponse(records: Array<Record<string, unknown>>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      output: {
        tableName: 'Table_0',
        columns: [],
        rows: [],
        records,
        rowCount: records.length,
        totalRowCount: records.length,
        truncated: false,
      },
    }),
  } as unknown as Response
}

describe('transformColumnListResponse', () => {
  it('collects the values of the named column', async () => {
    const transform = transformColumnListResponse('TableName', 'tables')
    const result = await transform(
      proxyResponse([{ TableName: 'StormEvents' }, { TableName: 'Logs' }])
    )

    expect(result.output.tables).toEqual(['StormEvents', 'Logs'])
  })

  it("keeps an empty extent ID, which is how Kusto reports 'no data shard was written'", async () => {
    const transform = transformColumnListResponse('ExtentId', 'extentIds')
    const result = await transform(proxyResponse([{ ExtentId: '' }]))

    expect(result.output.extentIds).toEqual([''])
    expect(result.output.rowCount).toBe(1)
  })

  it('skips a null value rather than coercing it to a string', async () => {
    const transform = transformColumnListResponse('TableName', 'tables')
    const result = await transform(proxyResponse([{ TableName: null }, { TableName: 'Logs' }]))

    expect(result.output.tables).toEqual(['Logs'])
  })
})
