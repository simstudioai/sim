import { describe, expect, it } from 'vitest'
import { CodaBlock } from '@/blocks/blocks/coda'

const mapParams = CodaBlock.tools.config?.params

/**
 * A tool call merges the stored row with the model's args (keyed by tool param names) and spreads
 * the mapper result over them; the operation arrives only in `context`.
 */
const toolCall = (args: Record<string, unknown>, operation: string) => ({
  ...args,
  ...mapParams?.(args, { operation }),
})

describe('CodaBlock', () => {
  it('keeps the model args a tool call sends under the tool param names', () => {
    const params = toolCall(
      { docId: 'doc-1', tableId: 'grid-1', query: 'Status:"Done"', sortBy: 'natural', limit: 5 },
      'list_rows'
    )
    expect(params.query).toBe('Status:"Done"')
    expect(params.sortBy).toBe('natural')
    expect(params.limit).toBe(5)
  })

  it('does not restore a sentinel or off switch the coercion dropped on a tool call', () => {
    const params = toolCall(
      { docId: 'd', tableTypes: 'all', isPublished: false, visibleOnly: 'false' },
      'list_tables'
    )
    expect(params.tableTypes).toBeUndefined()
    expect(params.isPublished).toBeUndefined()
    expect(params.visibleOnly).toBeUndefined()
  })

  it('keeps the array form of table types a tool call sends', () => {
    const params = toolCall({ docId: 'd', tableTypes: ['table'] }, 'list_tables')
    expect(params.tableTypes).toEqual(['table'])
  })

  it('still drops a stale raw input on the canvas', () => {
    const inputs = { operation: 'list_docs', query: 'stale', docSearch: 'roadmap', title: 'old' }
    const params = { ...inputs, ...mapParams?.(inputs) }
    expect(params.query).toBe('roadmap')
    expect(params.title).toBeUndefined()
  })
})
