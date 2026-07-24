/**
 * @vitest-environment node
 *
 * `fireTableTrigger` is fire-and-forget — it swallows every error (trigger.ts).
 * An `expect` thrown inside a mock would therefore be silently eaten and the
 * test would pass green, so every assertion runs on the captured payload AFTER
 * the `await`, never inside a mock factory.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchActiveWebhooks, mockProcessPolledWebhookEvent } = vi.hoisted(() => ({
  mockFetchActiveWebhooks: vi.fn(),
  mockProcessPolledWebhookEvent: vi.fn(),
}))

vi.mock('@/lib/webhooks/polling/utils', () => ({
  fetchActiveWebhooks: mockFetchActiveWebhooks,
}))
vi.mock('@/lib/webhooks/processor', () => ({
  processPolledWebhookEvent: mockProcessPolledWebhookEvent,
}))

import { fireTableTrigger } from '@/lib/table/trigger'
import type { RowData, TableSchema } from '@/lib/table/types'

const schema: TableSchema = {
  columns: [
    { id: 'col_title', name: 'Title', type: 'string' },
    {
      id: 'col_status',
      name: 'Status',
      type: 'select',
      options: [
        { id: 'opt_open', name: 'Open' },
        { id: 'opt_closed', name: 'Closed' },
      ],
    },
    {
      id: 'col_tags',
      name: 'Tags',
      type: 'select',
      multiple: true,
      options: [
        { id: 'opt_a', name: 'Alpha' },
        { id: 'opt_b', name: 'Beta' },
      ],
    },
  ],
}

interface Payload {
  row: Record<string, unknown> | null
  rawRow: Record<string, unknown>
  previousRow: Record<string, unknown> | null
  changedColumns: string[]
  headers: string[]
  rowId: string
}

function webhookEntry(config: Record<string, unknown> = {}) {
  return {
    webhook: { id: 'wh_1', providerConfig: { tableId: 'tbl_1', eventType: 'insert', ...config } },
    workflow: { id: 'wf_1' },
  }
}

function firedPayloads(): Payload[] {
  return mockProcessPolledWebhookEvent.mock.calls.map((call) => call[2] as Payload)
}

async function fire(
  eventType: 'insert' | 'update',
  data: RowData,
  oldRows: Map<string, RowData> | null = null
) {
  await fireTableTrigger(
    'tbl_1',
    'Issues',
    eventType,
    [{ id: 'row_1', data } as never],
    oldRows,
    schema,
    'req_1'
  )
}

describe('fireTableTrigger — select values', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProcessPolledWebhookEvent.mockResolvedValue({ success: true })
    mockFetchActiveWebhooks.mockResolvedValue([webhookEntry()])
  })

  it('emits option names, not stored option ids, in row and rawRow', async () => {
    await fire('insert', { col_title: 'Login broken', col_status: 'opt_open', col_tags: ['opt_a'] })

    const [payload] = firedPayloads()
    expect(payload.rawRow).toEqual({
      Title: 'Login broken',
      Status: 'Open',
      Tags: ['Alpha'],
    })
    expect(payload.row).toEqual({ Title: 'Login broken', Status: 'Open', Tags: ['Alpha'] })
  })

  it('emits option names in previousRow on an update', async () => {
    mockFetchActiveWebhooks.mockResolvedValue([webhookEntry({ eventType: 'update' })])
    await fire(
      'update',
      { col_status: 'opt_closed' },
      new Map([['row_1', { col_status: 'opt_open' }]])
    )

    const [payload] = firedPayloads()
    expect(payload.previousRow).toEqual({ Status: 'Open' })
    expect(payload.rawRow).toEqual({ Status: 'Closed' })
  })

  it('drops an option id whose option was deleted', async () => {
    await fire('insert', { col_status: 'opt_gone' })

    const [payload] = firedPayloads()
    expect(payload.rawRow.Status).toBeNull()
  })
})

describe('fireTableTrigger — payload shape', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProcessPolledWebhookEvent.mockResolvedValue({ success: true })
    mockFetchActiveWebhooks.mockResolvedValue([webhookEntry()])
  })

  it('row fills every column while rawRow omits absent ones', async () => {
    await fire('insert', { col_title: 'only this' })

    const [payload] = firedPayloads()
    expect(payload.rawRow).toEqual({ Title: 'only this' })
    expect(payload.row).toEqual({ Title: 'only this', Status: null, Tags: null })
  })

  it('row key set matches headers exactly', async () => {
    await fire('insert', { col_title: 'x' })

    const [payload] = firedPayloads()
    expect(Object.keys(payload.row as Record<string, unknown>)).toEqual(payload.headers)
  })

  it('omits row when includeHeaders is false', async () => {
    mockFetchActiveWebhooks.mockResolvedValue([webhookEntry({ includeHeaders: false })])
    await fire('insert', { col_title: 'x' })

    const [payload] = firedPayloads()
    expect(payload.row).toBeNull()
    expect(payload.rawRow).toEqual({ Title: 'x' })
  })

  it('reports changedColumns by display name', async () => {
    mockFetchActiveWebhooks.mockResolvedValue([webhookEntry({ eventType: 'update' })])
    await fire(
      'update',
      { col_status: 'opt_closed' },
      new Map([['row_1', { col_status: 'opt_open' }]])
    )

    const [payload] = firedPayloads()
    expect(payload.changedColumns).toEqual(['Status'])
  })
})

describe('fireTableTrigger — gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProcessPolledWebhookEvent.mockResolvedValue({ success: true })
  })

  it('fires nothing for a different table', async () => {
    mockFetchActiveWebhooks.mockResolvedValue([webhookEntry({ tableId: 'tbl_other' })])
    await fire('insert', { col_title: 'x' })
    expect(mockProcessPolledWebhookEvent).not.toHaveBeenCalled()
  })

  it('fires nothing when the event type does not match', async () => {
    mockFetchActiveWebhooks.mockResolvedValue([webhookEntry({ eventType: 'update' })])
    await fire('insert', { col_title: 'x' })
    expect(mockProcessPolledWebhookEvent).not.toHaveBeenCalled()
  })

  it('skips a row whose watched column did not change', async () => {
    mockFetchActiveWebhooks.mockResolvedValue([
      webhookEntry({ eventType: 'update', watchColumns: 'Tags' }),
    ])
    await fire(
      'update',
      { col_status: 'opt_closed' },
      new Map([['row_1', { col_status: 'opt_open' }]])
    )
    expect(mockProcessPolledWebhookEvent).not.toHaveBeenCalled()
  })

  it('fires when a watched column changed', async () => {
    mockFetchActiveWebhooks.mockResolvedValue([
      webhookEntry({ eventType: 'update', watchColumns: 'Status' }),
    ])
    await fire(
      'update',
      { col_status: 'opt_closed' },
      new Map([['row_1', { col_status: 'opt_open' }]])
    )
    expect(mockProcessPolledWebhookEvent).toHaveBeenCalledTimes(1)
  })
})
