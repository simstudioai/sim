/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { providerText } from '@/lib/sim-search/live/text'

describe('providerText', () => {
  it('decodes an escaped snippet and drops preheader padding', () => {
    const padding = String.fromCodePoint(0x034f, 0x20, 0x200c, 0x200b, 0x200d, 0x200e, 0xfeff, 0xad)
    expect(providerText(`Receipt from Exa &#39;Labs&#39; ${padding.repeat(3)}`, 'escaped')).toBe(
      "Receipt from Exa 'Labs'"
    )
  })
  it('keeps a zero-width joiner that composes an emoji', () => {
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)
    expect(providerText(`Team ${family}`)).toBe(`Team ${family}`)
  })
  it('keeps line structure when converting markup to text', () => {
    expect(
      providerText(
        '<p>Who:</p><p><a href="mailto:a@b.co">a@b.co</a><br>Notes &amp; links</p>',
        'html'
      )
    ).toBe('Who:\n\na@b.co\nNotes & links')
  })
  it('leaves plain text with angle brackets untouched in auto mode', () => {
    expect(providerText('Reply from John <john@acme.com>', 'auto')).toBe(
      'Reply from John <john@acme.com>'
    )
  })
  it('keeps the spacing of plain text documents', () => {
    const table = '  Name      Qty\n  Widget    2\n\n> quoted reply\n    indented code'
    expect(providerText(`${table}   \n\n\n`)).toBe(table)
  })
  it('removes invisible characters inside a word without splitting it', () => {
    const softHyphen = String.fromCodePoint(0xad)
    expect(providerText(`hyphen${softHyphen}ation`)).toBe('hyphenation')
  })
  it('does not decode entities in plain text', () => {
    expect(providerText('Use &lt;b&gt; for bold')).toBe('Use &lt;b&gt; for bold')
  })
})
