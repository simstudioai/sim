/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sanitizePathSegment } from '@/lib/workflows/operations/import-export'

describe('sanitizePathSegment', () => {
  it('should preserve ASCII alphanumeric characters', () => {
    expect(sanitizePathSegment('workflow-123_abc')).toBe('workflow-123_abc')
  })

  it('should replace spaces with dashes', () => {
    expect(sanitizePathSegment('my workflow')).toBe('my-workflow')
  })

  it('should replace special characters with dashes', () => {
    expect(sanitizePathSegment('workflow!@#')).toBe('workflow-')
  })

  it('should preserve Korean characters (BUG REPRODUCTION)', () => {
    expect(sanitizePathSegment('한글')).toBe('한글')
  })

  it('should preserve other Unicode characters', () => {
    expect(sanitizePathSegment('日本語')).toBe('日本語')
  })

  it('should remove filesystem unsafe characters', () => {
    expect(sanitizePathSegment('work/flow?name*')).not.toContain('/')
    expect(sanitizePathSegment('work/flow?name*')).not.toContain('?')
    expect(sanitizePathSegment('work/flow?name*')).not.toContain('*')
  })
})
