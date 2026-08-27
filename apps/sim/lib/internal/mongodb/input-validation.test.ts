/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  sanitizeMongodbCollectionName,
  validateMongodbFilter,
  validateMongodbPipeline,
} from '@/lib/internal/mongodb/input-validation'

describe('MongoDB input validation', () => {
  it('preserves filter validation and nested dangerous-operator detection', () => {
    expect(validateMongodbFilter('{"status":"active"}')).toEqual({ isValid: true })
    expect(validateMongodbFilter('{"nested":{"$where":"return true"}}')).toEqual({
      isValid: false,
      error: 'Filter contains potentially dangerous operators',
    })
    expect(validateMongodbFilter('{invalid')).toEqual({
      isValid: false,
      error: 'Invalid JSON format in filter',
    })
  })

  it('preserves pipeline shape and dangerous-stage validation', () => {
    expect(validateMongodbPipeline('[{"$match":{"status":"active"}}]')).toEqual({
      isValid: true,
    })
    expect(validateMongodbPipeline('{"$match":{}}')).toEqual({
      isValid: false,
      error: 'Pipeline must be an array',
    })
    expect(validateMongodbPipeline('[{"$out":"archive"}]')).toEqual({
      isValid: false,
      error: 'Pipeline contains potentially dangerous operators',
    })
  })

  it('preserves collection-name validation', () => {
    expect(sanitizeMongodbCollectionName('users_2026')).toBe('users_2026')
    expect(() => sanitizeMongodbCollectionName('users.events')).toThrow('Invalid collection name')
  })
})
