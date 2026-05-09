import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from '@/lib/pptx-renderer/utils/url-safety'

describe('isAllowedExternalUrl', () => {
  it('allows http, https, and mailto URLs', () => {
    expect(isAllowedExternalUrl('https://example.com/deck')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com/deck')).toBe(true)
    expect(isAllowedExternalUrl('mailto:support@example.com')).toBe(true)
  })

  it('rejects scriptable, data, and relative URLs', () => {
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isAllowedExternalUrl('/workspace/files')).toBe(false)
  })
})
