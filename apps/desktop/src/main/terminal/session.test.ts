import { describe, expect, it } from 'vitest'
import { stripAnsi, stripTerminalQueries, toInputChunks } from '@/main/terminal/session'

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

describe('stripTerminalQueries', () => {
  // Replaying recorded bytes into a live emulator makes it answer every query
  // in the recording, and those answers are written to the pty as keystrokes.
  // With the asker long gone they pile up on the shell prompt as junk.
  it('removes device attribute queries and their replies', () => {
    expect(stripTerminalQueries('a\u001b[cb')).toBe('ab')
    expect(stripTerminalQueries('a\u001b[>cb')).toBe('ab')
    expect(stripTerminalQueries('a\u001b[?1;2cb')).toBe('ab')
    expect(stripTerminalQueries('a\u001b[>0;276;0cb')).toBe('ab')
  })

  it('removes device status reports', () => {
    expect(stripTerminalQueries('a\u001b[6nb')).toBe('ab')
    expect(stripTerminalQueries('a\u001b[?6nb')).toBe('ab')
  })

  it('removes the OSC colour queries that echo as rgb: junk', () => {
    expect(stripTerminalQueries('a\u001b]10;?\u0007b')).toBe('ab')
    expect(stripTerminalQueries('a\u001b]11;?\u001b\\b')).toBe('ab')
  })

  it('removes XTVERSION without touching cursor style', () => {
    expect(stripTerminalQueries('a\u001b[>0qb')).toBe('ab')
    // `CSI q` sets the cursor shape and must survive, so the `>` is required.
    expect(stripTerminalQueries('a\u001b[2 qb')).toBe('a\u001b[2 qb')
  })

  it('removes the capability query', () => {
    expect(stripTerminalQueries('a\u001bP+q544e\u001b\\b')).toBe('ab')
  })

  it('leaves colour and formatting in the recording intact', () => {
    expect(stripTerminalQueries('\u001b[31mred\u001b[0m\r\n')).toBe('\u001b[31mred\u001b[0m\r\n')
  })

  it('leaves text with no queries untouched', () => {
    expect(stripTerminalQueries('plain output\n')).toBe('plain output\n')
  })
})
