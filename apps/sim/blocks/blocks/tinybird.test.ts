/**
 * An Agent tool call runs the block mapper over `{ ...storedRowParams, ...modelArgs }` with the
 * operation only in `context`; the tool then receives `{ ...merged, ...mapped }`.
 */
import { describe, expect, it } from 'vitest'
import { TinybirdBlock } from '@/blocks/blocks/tinybird'

function toolCallParams(args: Record<string, unknown>, operation: string) {
  const mapped = TinybirdBlock.tools.config?.params?.(args, { operation }) ?? {}
  return { ...args, ...mapped }
}

describe('Tinybird on an Agent tool call', () => {
  it('runs the selected operation instead of requiring Send Events fields', () => {
    expect(toolCallParams({ token: 'tok', query: 'SELECT 1' }, 'tinybird_query')).toMatchObject({
      query: 'SELECT 1',
    })
  })

  it('appends from the source URL the model supplied as url', () => {
    expect(
      toolCallParams(
        { token: 'tok', datasource: 'events', url: 'https://example.com/data.csv' },
        'tinybird_append_datasource'
      )
    ).toMatchObject({ datasource: 'events', url: 'https://example.com/data.csv', format: 'csv' })
  })
  it('keeps the source format the model supplied as format', () => {
    expect(
      toolCallParams(
        {
          token: 'tok',
          datasource: 'events',
          url: 'https://example.com/data.ndjson',
          format: 'ndjson',
        },
        'tinybird_append_datasource'
      )
    ).toMatchObject({ format: 'ndjson' })
  })
})
