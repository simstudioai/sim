/**
 * Tests for shared knowledge contract schemas
 */
import { describe, expect, it } from 'vitest'
import { knowledgeDocumentFileUrlSchema } from '@/lib/api/contracts/knowledge/shared'

describe('knowledgeDocumentFileUrlSchema', () => {
  it('accepts data: URIs', () => {
    const result = knowledgeDocumentFileUrlSchema.safeParse(
      'data:text/plain;base64,SGVsbG8gd29ybGQ='
    )
    expect(result.success).toBe(true)
  })

  it('accepts https URLs', () => {
    const result = knowledgeDocumentFileUrlSchema.safeParse('https://example.com/file.pdf')
    expect(result.success).toBe(true)
  })

  it.each([
    ['absolute local path', '/etc/passwd'],
    ['relative path', './secrets.txt'],
    ['file:// scheme', 'file:///etc/passwd'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['empty string', ''],
    ['whitespace prefix', ' https://example.com/x'],
  ])('rejects %s', (_label, value) => {
    const result = knowledgeDocumentFileUrlSchema.safeParse(value)
    expect(result.success).toBe(false)
  })
})
