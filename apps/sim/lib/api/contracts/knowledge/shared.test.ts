/**
 * Tests for shared knowledge contract schemas
 *
 * @vitest-environment node
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

  it('accepts http URLs', () => {
    const result = knowledgeDocumentFileUrlSchema.safeParse(
      'http://localhost:3000/api/files/serve/kb/foo.pdf?context=knowledge-base'
    )
    expect(result.success).toBe(true)
  })

  it('is case-insensitive on the scheme', () => {
    expect(knowledgeDocumentFileUrlSchema.safeParse('HTTPS://example.com/x').success).toBe(true)
    expect(knowledgeDocumentFileUrlSchema.safeParse('Http://example.com/x').success).toBe(true)
  })

  it.each([
    ['absolute local path', '/etc/passwd'],
    ['app path', '/app/.env'],
    ['relative path', './secrets.txt'],
    ['parent traversal', '../../etc/shadow'],
    ['file:// scheme', 'file:///etc/passwd'],
    ['ftp scheme', 'ftp://example.com/x'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['gopher scheme', 'gopher://example.com'],
    ['relative serve path', '/api/files/serve/kb/foo.pdf'],
    ['windows path', 'C:\\Windows\\System32\\config\\SAM'],
    ['empty string', ''],
    ['whitespace prefix', ' https://example.com/x'],
  ])('rejects %s', (_label, value) => {
    const result = knowledgeDocumentFileUrlSchema.safeParse(value)
    expect(result.success).toBe(false)
  })

  it('returns a useful error message for unsupported schemes', () => {
    const result = knowledgeDocumentFileUrlSchema.safeParse('/etc/passwd')
    if (result.success) throw new Error('expected failure')
    expect(result.error.issues[0].message).toMatch(/data: URI or an http\(s\):\/\/ URL/)
  })
})
