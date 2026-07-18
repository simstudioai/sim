import { describe, expect, it } from 'vitest'
import { safeJsonForScript } from '@/lib/apps/safe-json'

describe('safeJsonForScript', () => {
  it('escapes script breakouts and unicode line separators', () => {
    const raw = safeJsonForScript({
      x: '</script><script>alert(1)</script>',
      y: 'line\u2028break\u2029',
    })
    expect(raw.includes('<')).toBe(false)
    expect(raw).toContain('\\u003c')
    expect(raw).toContain('\\u2028')
    expect(raw).toContain('\\u2029')
  })
})
