import { describe, expect, it } from 'vitest'
import { FivetranBlock } from '@/blocks/blocks/fivetran'
import type { BlockToolParamsContext } from '@/blocks/types'

/** Mirrors the tool-call path: the mapper result is spread over the merged params. */
function toolCallParams(args: Record<string, unknown>, context: BlockToolParamsContext) {
  const mapper = FivetranBlock.tools.config?.params
  if (!mapper) throw new Error('Fivetran block has no params mapper')
  return { ...args, ...mapper(args, context) }
}

describe('Fivetran agent tool calls', () => {
  it('pauses the connection when the operation arrives only in the context', () => {
    const sent = toolCallParams(
      { connectionId: 'c1', syncFrequency: 60 },
      { operation: 'pause_connection' }
    )
    expect(sent.paused).toBe(true)
    expect(sent.syncFrequency).toBeUndefined()
  })

  it.each([
    ['create_group', { name: 'Analytics' }],
    ['create_destination', { groupId: 'g1', service: 'snowflake', config: { host: 'h' } }],
    ['update_schema_config', { connectionId: 'c1', schemas: { public: { enabled: true } } }],
    [
      'update_connection_schema',
      { connectionId: 'c1', schemaName: 'public', enabled: false, tables: { t: {} } },
    ],
    [
      'update_connection_table',
      { connectionId: 'c1', schemaName: 'public', tableName: 't', enabled: true },
    ],
  ])('keeps the model arguments for %s', (operation, args) => {
    expect(toolCallParams(args, { operation })).toMatchObject(args)
  })
})
