import { describe, expect, it } from 'vitest'
import { stripAnsi, toKeystrokes } from '@/main/terminal/session'

describe('toKeystrokes', () => {
  it('sends Enter as carriage return, not linefeed', () => {
    // A full-screen program reading raw input treats LF as "insert a line" and
    // CR as "submit", so text sent with \n types but never sends.
    expect(toKeystrokes('hi\n')).toBe('hi\r')
  })

  it('collapses CRLF so one Enter is not sent twice', () => {
    expect(toKeystrokes('hi\r\n')).toBe('hi\r')
  })

  it('converts every line break in multi-line input', () => {
    expect(toKeystrokes('one\ntwo\nthree')).toBe('one\rtwo\rthree')
  })

  it('leaves text without line breaks untouched', () => {
    expect(toKeystrokes('y')).toBe('y')
    expect(toKeystrokes('')).toBe('')
  })

  it('preserves an existing carriage return', () => {
    expect(toKeystrokes('hi\r')).toBe('hi\r')
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
