/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ensureZodObject, normalizeStagehandUrl } from '@/lib/internal/stagehand/schema-conversion'

const logger = {
  warn: () => {},
  error: () => {},
} as Parameters<typeof ensureZodObject>[0]

describe('Stagehand schema conversion', () => {
  it('preserves required and optional JSON-schema properties', () => {
    const schema = ensureZodObject(logger, {
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'integer' },
      },
      required: ['title'],
    })

    expect(schema.parse({ title: 'Example' })).toEqual({ title: 'Example' })
    expect(schema.safeParse({ count: 1 }).success).toBe(false)
  })

  it('normalizes scheme-less URLs without changing absolute URLs', () => {
    expect(normalizeStagehandUrl('example.com')).toBe('https://example.com')
    expect(normalizeStagehandUrl('http://example.com')).toBe('http://example.com')
  })
})
