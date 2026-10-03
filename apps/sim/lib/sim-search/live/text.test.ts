import { describe, expect, it } from 'vitest'
import { providerText } from '@/lib/sim-search/live/text'

describe('providerText', () => {
  it('removes invisible characters inside a word without splitting it', () => {
    const softHyphen = String.fromCodePoint(0xad)
    expect(providerText(`hyphen${softHyphen}ation`)).toBe('hyphenation')
  })
  it('does not throw on deeply nested markup', () => {
    expect(() => providerText(`${'<b>'.repeat(20000)}x`, 'html')).not.toThrow()
  })
  it.each(['plain', 'escaped'] as const)(
    'cleans a long run of spaces in linear time (%s)',
    (format) => {
      const started = performance.now()
      expect(providerText(`${' '.repeat(1_000_000)}x`, format)).toContain('x')
      expect(performance.now() - started).toBeLessThan(1000)
    }
  )
  it('removes a stray byte-order mark inside a word without adding a space', () => {
    expect(providerText(`doc${String.fromCodePoint(0xfeff)}ument`)).toBe('document')
  })
})
