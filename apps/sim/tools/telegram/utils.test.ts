import { describe, expect, it } from 'vitest'
import { convertMarkdownToHTML } from '@/tools/telegram/utils'

describe('convertMarkdownToHTML', () => {
  it('escapes <, > and & that are not part of a tag or entity', () => {
    expect(convertMarkdownToHTML('Latency < 200ms & rising > p99')).toBe(
      'Latency &lt; 200ms &amp; rising &gt; p99'
    )
  })

  it('escapes unsupported tags but keeps the ones Telegram accepts', () => {
    expect(convertMarkdownToHTML('<b>Alert</b> on <div>host</div>')).toBe(
      '<b>Alert</b> on &lt;div&gt;host&lt;/div&gt;'
    )
  })

  it('keeps supported entities as they are', () => {
    expect(convertMarkdownToHTML('a &lt; b &#8212; c &amp; d')).toBe('a &lt; b &#8212; c &amp; d')
  })

  it('leaves underscores inside words and link URLs alone', () => {
    expect(convertMarkdownToHTML('see [docs](https://x.com/a_b_c) for snake_case_name')).toBe(
      'see <a href="https://x.com/a_b_c">docs</a> for snake_case_name'
    )
  })

  it('does not apply emphasis inside code spans', () => {
    expect(convertMarkdownToHTML('run `a*b*c` now')).toBe('run <code>a*b*c</code> now')
  })

  it('still converts markdown emphasis', () => {
    expect(convertMarkdownToHTML('**bold** __b2__ *it* _i2_')).toBe(
      '<b>bold</b> <b>b2</b> <i>it</i> <i>i2</i>'
    )
  })

  it('shows a supported tag inside a code span as literal text', () => {
    expect(convertMarkdownToHTML('use `<b>` for bold')).toBe('use <code>&lt;b&gt;</code> for bold')
    expect(convertMarkdownToHTML('`<code>x</code>`')).toBe(
      '<code>&lt;code&gt;x&lt;/code&gt;</code>'
    )
  })

  it('escapes a supported tag inside a link URL', () => {
    expect(convertMarkdownToHTML('[a](https://x.com/<b>)')).toBe(
      '<a href="https://x.com/&lt;b&gt;">a</a>'
    )
  })

  it('never reads placeholder-shaped input as a set-aside segment', () => {
    expect(convertMarkdownToHTML('<b>x</b> \u00000\u0000')).toBe('<b>x</b> 0')
  })

  it('keeps a spoiler span but escapes any other span', () => {
    expect(convertMarkdownToHTML('<span class="tg-spoiler">a</span> <span id="x">b')).toBe(
      '<span class="tg-spoiler">a</span> &lt;span id="x"&gt;b'
    )
  })
})
