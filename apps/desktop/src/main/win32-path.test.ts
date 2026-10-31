import { describe, expect, it } from 'vitest'
import { isWin32SafeSegment, toWin32SafeFileName } from '@/main/win32-path'

describe('isWin32SafeSegment', () => {
  it.each(['CON', 'con', 'Nul.txt', 'COM1', 'lpt9.log', 'CON .txt', 'COM¹'])(
    'refuses the reserved device name %s',
    (segment) => {
      expect(isWin32SafeSegment(segment)).toBe(false)
    }
  )

  it.each(['file.txt:stream', 'a<b', 'a>b', 'a"b', 'a|b', 'a?b', 'a*b', 'a\\b', 'a/b', 'a\tb'])(
    'refuses %s, which holds a character NTFS rejects or reads as a stream',
    (segment) => {
      expect(isWin32SafeSegment(segment)).toBe(false)
    }
  )

  it.each(['file.', 'file ', '...'])('refuses %s, which Windows would silently trim', (segment) => {
    expect(isWin32SafeSegment(segment)).toBe(false)
  })

  it.each(['notes.txt', 'CONFIG', 'console.log', 'com10', '.env'])('accepts %s', (segment) => {
    expect(isWin32SafeSegment(segment)).toBe(true)
  })
})

describe('toWin32SafeFileName', () => {
  it('replaces characters NTFS rejects', () => {
    expect(toWin32SafeFileName('Q3: plan <draft>|"final"?*.pdf')).toBe(
      'Q3_ plan _draft___final___.pdf'
    )
  })

  it('drops the trailing dots and spaces Windows would strip', () => {
    expect(toWin32SafeFileName('report. . ')).toBe('report')
  })

  it('keeps a reserved device stem from opening the device', () => {
    expect(toWin32SafeFileName('nul.txt')).toBe('_nul.txt')
    expect(toWin32SafeFileName('AUX')).toBe('_AUX')
  })

  it('leaves an ordinary name alone', () => {
    expect(toWin32SafeFileName('Q3 plan.pdf')).toBe('Q3 plan.pdf')
  })

  it('produces a name that passes the segment check', () => {
    for (const name of ['CON:x.', 'a*b ', 'lpt1', 'x|y.']) {
      const safe = toWin32SafeFileName(name)
      expect(isWin32SafeSegment(safe)).toBe(true)
    }
  })
})
