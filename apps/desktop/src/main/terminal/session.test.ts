import { describe, expect, it } from 'vitest'
import { stripAnsi, toInputChunks } from '@/main/terminal/session'

describe('toInputChunks', () => {
  it('separates Enter from the text so the text is actually submitted', () => {
    // A full-screen program reads one stdin chunk as one input event: "hi\r"
    // arriving together is read as text, lands in the composer, and never
    // submits. Enter has to be its own chunk.
    expect(toInputChunks('hi\n')).toEqual(['hi', '\r'])
  })

  it('sends Enter as carriage return, not linefeed', () => {
    expect(toInputChunks('hi\n')[1]).toBe('\r')
  })

  it('collapses CRLF so one Enter is not sent twice', () => {
    expect(toInputChunks('hi\r\n')).toEqual(['hi', '\r'])
  })

  it('treats a bare carriage return as one Enter', () => {
    expect(toInputChunks('hi\r')).toEqual(['hi', '\r'])
  })

  it('breaks multi-line input into alternating text and Enter', () => {
    expect(toInputChunks('one\ntwo\nthree')).toEqual(['one', '\r', 'two', '\r', 'three'])
  })

  it('keeps a blank line as an Enter rather than an empty write', () => {
    expect(toInputChunks('\n')).toEqual(['\r'])
    expect(toInputChunks('a\n\nb')).toEqual(['a', '\r', '\r', 'b'])
  })

  it('leaves text without line breaks as a single chunk', () => {
    expect(toInputChunks('y')).toEqual(['y'])
  })

  it('sends nothing for empty text', () => {
    expect(toInputChunks('')).toEqual([])
  })
})

describe('stripAnsi', () => {
  it('removes colour and cursor sequences so the model reads plain text', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red')
    expect(stripAnsi('a\u001b[2Kb')).toBe('ab')
  })

  it('removes OSC sequences including their terminator', () => {
    expect(stripAnsi('before\u001b]0;window title\u0007after')).toBe('beforeafter')
  })

  it('keeps newlines and tabs, which carry real structure', () => {
    expect(stripAnsi('one\ntwo\tthree')).toBe('one\ntwo\tthree')
  })
})
