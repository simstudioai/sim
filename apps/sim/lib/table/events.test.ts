import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  setEnv({ REDIS_URL: undefined })
})

afterAll(resetEnvMock)

import type { TableEvent } from '@/lib/table/events'
import { appendTableEvent, getLatestTableEventId, readTableEventsSince } from '@/lib/table/events'

/** Module-level memory buffer can't be reset without vi.resetModules — use a
 *  unique tableId per test to avoid cross-test bleed. */
let seq = 0
function uniqueTableId(): string {
  seq++
  return `table-events-test-${seq}`
}

function cellEvent(tableId: string): TableEvent {
  return {
    kind: 'cell',
    tableId,
    rowId: 'row-1',
    groupId: 'group-1',
    status: 'running',
  }
}

describe('getLatestTableEventId (memory buffer)', () => {
  it('returns the latest assigned eventId after appends', async () => {
    const tableId = uniqueTableId()
    await appendTableEvent(cellEvent(tableId))
    const second = await appendTableEvent(cellEvent(tableId))
    expect(second?.eventId).toBe(2)
    expect(await getLatestTableEventId(tableId)).toBe(2)
  })

  it('tailing from the latest id yields no replayed events', async () => {
    const tableId = uniqueTableId()
    await appendTableEvent(cellEvent(tableId))
    await appendTableEvent(cellEvent(tableId))
    const latest = await getLatestTableEventId(tableId)
    const result = await readTableEventsSince(tableId, latest)
    expect(result).toEqual({ status: 'ok', events: [] })
  })

  it('a subsequent append is visible to a reader tailing from the prior latest', async () => {
    const tableId = uniqueTableId()
    await appendTableEvent(cellEvent(tableId))
    const latest = await getLatestTableEventId(tableId)
    await appendTableEvent(cellEvent(tableId))
    const result = await readTableEventsSince(tableId, latest)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.events).toHaveLength(1)
      expect(result.events[0].eventId).toBe(latest + 1)
    }
  })
})
