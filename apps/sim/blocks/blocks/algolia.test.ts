import { describe, expect, it } from 'vitest'
import { AlgoliaBlock } from '@/blocks/blocks/algolia'

/** Runs the mapper the way an Agent tool call does: its result is spread over the merged args. */
function toolCall(args: Record<string, unknown>, operation: string) {
  const mapParams = AlgoliaBlock.tools.config?.params
  if (!mapParams) throw new Error('Algolia block has no params mapper')
  return { ...args, ...mapParams(args, { operation }) }
}

describe('AlgoliaBlock agent tool calls', () => {
  it('maps the block-field requests key on a tool call', () => {
    expect(
      toolCall({ indexName: 'products', getRecordsRequests: '[{"objectID":"1"}]' }, 'get_records')
    ).toMatchObject({ requests: '[{"objectID":"1"}]' })
  })

  it('keeps the model filters, requests, and copy-or-move operation', () => {
    expect(toolCall({ indexName: 'p', filters: 'brand:x' }, 'delete_by_filter')).toMatchObject({
      filters: 'brand:x',
    })
    expect(
      toolCall({ indexName: 'p', requests: [{ objectID: '1' }] }, 'get_records')
    ).toMatchObject({ requests: [{ objectID: '1' }] })
    expect(
      toolCall({ indexName: 'p', destination: 'q', operation: 'move' }, 'copy_move_index')
    ).toMatchObject({ operation: 'move' })
  })
})
