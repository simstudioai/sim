import { beforeEach, describe, expect, it, vi } from 'vitest'
import { printProtocolResult } from './result'

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

let logged: string[]

beforeEach(() => {
  logged = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line)
  })
})

describe('printProtocolResult', () => {
  it.each(['text', 'table'] as const)(
    'sanitizes a display override built from server text in %s output',
    (format) => {
      const key = `leads${ESC}]0;pwned${BEL}${ESC}[2A`
      printProtocolResult(
        format,
        { created: [{ kind: 'table', key }] },
        { created: `table ${key}` }
      )

      expect(logged.join('\n')).not.toContain(ESC)
      expect(logged.join('\n')).not.toContain(BEL)
      expect(logged.join('\n')).toContain('table leads')
    }
  )
})
