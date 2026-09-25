import { describe, expect, it } from 'vitest'
import { collectMarkdownImageSources } from './markdown-images'

describe('standard Markdown image references', () => {
  it('reads paths with spaces and parentheses, including named references', () => {
    expect(
      collectMarkdownImageSources(
        '![A](</tmp/diagram one.png>)\n![B](files/plot(2).png "Plot")\n![C][upload]\n\n[upload]: uploads/c.png'
      )
    ).toEqual(['/tmp/diagram one.png', 'files/plot(2).png', 'uploads/c.png'])
  })

  it('keeps code, escaped examples, links, raw HTML and incomplete syntax out of publication', () => {
    expect(
      collectMarkdownImageSources(
        '`![code](/tmp/code.png)`\n\n```md\n![fenced](/tmp/fenced.png)\n```\n\n\\![escaped](/tmp/escape.png)\n[link](/tmp/link.png)\n<img src="/tmp/html.png">\n![partial](/tmp/partial.png'
      )
    ).toEqual([])
  })

  it('deduplicates repeated sources and leaves source authorization to the resolver', () => {
    expect(
      collectMarkdownImageSources(
        '![A](/tmp/a.png) ![A again](/tmp/a.png) ![Remote](https://example.com/a.png)'
      )
    ).toEqual(['/tmp/a.png', 'https://example.com/a.png'])
  })
})
