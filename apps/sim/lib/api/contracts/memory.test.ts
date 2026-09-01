/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { memoryListQuerySchema } from '@/lib/api/contracts/memory'

describe('memory list contract', () => {
  it('defaults and validates the list without changing the legacy upper bound', () => {
    expect(memoryListQuerySchema.parse({}).limit).toBe(50)
    expect(memoryListQuerySchema.parse({ limit: '100' }).limit).toBe(100)
    expect(memoryListQuerySchema.parse({ limit: '101' }).limit).toBe(101)
    expect(() => memoryListQuerySchema.parse({ limit: '0' })).toThrow()
    expect(() => memoryListQuerySchema.parse({ limit: 'invalid' })).toThrow()
  })
})
