/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { tableNewRowTrigger } from '@/triggers/table/poller'

describe('table trigger events', () => {
  it('offers insert, update, and delete row events', () => {
    const eventType = tableNewRowTrigger.subBlocks.find((subBlock) => subBlock.id === 'eventType')
    const options = eventType?.options as Array<{ id: string; label: string }> | undefined

    expect(options).toEqual([
      { id: 'insert', label: 'Row Inserted' },
      { id: 'update', label: 'Row Updated' },
      { id: 'delete', label: 'Row Deleted' },
    ])
  })

  it('keeps watched-column filtering specific to updates', () => {
    const watchColumns = tableNewRowTrigger.subBlocks.find(
      (subBlock) => subBlock.id === 'watchColumns'
    )

    expect(watchColumns?.condition).toEqual({ field: 'eventType', value: 'update' })
  })
})
