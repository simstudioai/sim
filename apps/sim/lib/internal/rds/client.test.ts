import type { RDSDataClient } from '@aws-sdk/client-rds-data'
import { describe, expect, it, vi } from 'vitest'
import { executeDelete, executeStatement } from '@/lib/internal/rds/client'

describe('executeStatement', () => {
  it('preserves null elements in nested array values', async () => {
    const send = vi.fn().mockResolvedValue({
      columnMetadata: [{ name: 'values' }],
      records: [
        [
          {
            arrayValue: {
              arrayValues: [{ stringValues: ['first', null] }, null, { longValues: [1, null] }],
            },
          },
        ],
      ],
    })
    const client = { send } as unknown as RDSDataClient

    await expect(
      executeStatement(client, 'resource-arn', 'secret-arn', 'database', 'SELECT values')
    ).resolves.toEqual({
      rows: [{ values: [['first', null], null, [1, null]] }],
      rowCount: 1,
    })
  })

  it('counts returned records for a SELECT, which reports numberOfRecordsUpdated as 0', async () => {
    const send = vi.fn().mockResolvedValue({
      numberOfRecordsUpdated: 0,
      columnMetadata: [{ name: 'id' }],
      records: [[{ longValue: 1 }], [{ longValue: 2 }]],
    })
    const client = { send } as unknown as RDSDataClient

    const result = await executeStatement(client, 'arn', 'secret', 'db', 'SELECT id FROM t')
    expect(result.rowCount).toBe(2)
  })

  it('reports affected rows for a write that returns no records', async () => {
    const send = vi.fn().mockResolvedValue({ numberOfRecordsUpdated: 3, generatedFields: [] })
    const client = { send } as unknown as RDSDataClient

    const result = await executeStatement(client, 'arn', 'secret', 'db', 'UPDATE t SET a = 1')
    expect(result.rowCount).toBe(3)
  })
})

describe('parameter binding', () => {
  it('binds quoted column names to placeholders the SQL actually references', async () => {
    const send = vi.fn().mockResolvedValue({ numberOfRecordsUpdated: 1 })
    const client = { send } as unknown as RDSDataClient

    await executeDelete(client, 'arn', 'secret', 'db', 'users', { '"id"': 7 })

    const input = send.mock.calls[0]?.[0].input
    expect(input.sql).toBe('DELETE FROM users WHERE id = :id')
    expect(input.parameters).toEqual([{ name: 'id', value: { longValue: 7 } }])
  })
})
