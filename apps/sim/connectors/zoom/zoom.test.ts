/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseVtt } from '@/connectors/zoom/zoom'

const HEADER = 'WEBVTT\n\n'

describe('parseVtt', () => {
  it.concurrent('returns empty string for input with no cues', () => {
    expect(parseVtt(HEADER)).toBe('')
  })

  it.concurrent('extracts plain spoken text from a single cue', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\nHello world\n`
    expect(parseVtt(vtt)).toBe('Hello world')
  })

  it.concurrent('preserves WebVTT voice tags as "Speaker: text"', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n<v Alice>hello there</v>\n`
    expect(parseVtt(vtt)).toBe('Alice: hello there')
  })

  it.concurrent('preserves voice tags with class suffix', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n<v.host Bob>welcome</v>\n`
    expect(parseVtt(vtt)).toBe('Bob: welcome')
  })

  it.concurrent('strips inline formatting tags but keeps text', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n<b>bold</b> and <i>italic</i>\n`
    expect(parseVtt(vtt)).toBe('bold and italic')
  })

  it.concurrent('strips karaoke timestamp tags', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\nhello <00:00:01.000>world\n`
    expect(parseVtt(vtt)).toBe('hello world')
  })

  it.concurrent('strips class spans', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n<c.loud>SHOUT</c>\n`
    expect(parseVtt(vtt)).toBe('SHOUT')
  })

  it.concurrent('skips cue identifier lines before timing', () => {
    const vtt = `${HEADER}cue-1\n00:00:00.000 --> 00:00:02.000\nhello\n`
    expect(parseVtt(vtt)).toBe('hello')
  })

  it.concurrent('joins multiple cues with newlines', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\nfirst\n\n00:00:02.000 --> 00:00:04.000\nsecond\n`
    expect(parseVtt(vtt)).toBe('first\nsecond')
  })

  it.concurrent('collapses repeated whitespace within a cue', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\nhello   world\n`
    expect(parseVtt(vtt)).toBe('hello world')
  })

  it.concurrent('iteratively strips overlapping tags that reconstruct after one pass', () => {
    const crafted = '<<b>b>injected</<b>b>'
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n${crafted}\n`
    const result = parseVtt(vtt)
    expect(result).not.toMatch(/<\/?[^>]+>/)
    expect(result).toContain('injected')
  })

  it.concurrent('iteratively strips nested script-like tag fragments', () => {
    const crafted = '<scr<script>ipt>alert(1)</scr</script>ipt>'
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n${crafted}\n`
    const result = parseVtt(vtt)
    expect(result).not.toMatch(/<\/?[^>]+>/)
    expect(result.toLowerCase()).not.toContain('script')
  })

  it.concurrent('sanitizes crafted speaker names that embed tag fragments', () => {
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n<v <b>Evil</b>>payload</v>\n`
    const result = parseVtt(vtt)
    expect(result).not.toMatch(/<\/?[^>]+>/)
  })

  it.concurrent('terminates on adversarial deeply-nested input', () => {
    const crafted = `${'<'.repeat(50)}b${'>'.repeat(50)}text${'<'.repeat(50)}/b${'>'.repeat(50)}`
    const vtt = `${HEADER}00:00:00.000 --> 00:00:02.000\n${crafted}\n`
    const result = parseVtt(vtt)
    expect(result).not.toMatch(/<\/?[^>]+>/)
  })
})
