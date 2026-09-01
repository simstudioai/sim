/**
 * @vitest-environment node
 */
import type { RDSDataClient } from '@aws-sdk/client-rds-data'
import { describe, expect, it, vi } from 'vitest'
import { executeStatement } from '@/lib/internal/rds/client'

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
})
