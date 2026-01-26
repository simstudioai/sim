/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('IRIS integration', () => {
  it('supports CURRENT_TIMESTAMP', async () => {
    const result = await db.execute(sql`SELECT CURRENT_TIMESTAMP AS now`)
    expect(result).toBeDefined()
  })
})
