import { Chalk } from 'chalk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Column, printList, printRecord, sanitize } from './render'

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

/** Colour is stripped when not writing to a TTY, so force it on for these assertions. */
const coloured = new Chalk({ level: 1 })

let logged: string[]

beforeEach(() => {
  logged = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line)
  })
})

interface Row {
  name: string
  status: string
}

const COLUMNS: Column<Row>[] = [
  { header: 'name', value: (row) => row.name },
  { header: 'status', value: (row) => row.status },
]

describe('printList', () => {
  it('starts the second column at the same visible offset on every line', () => {
    printList(
      'table',
      [
        { name: 'alpha', status: coloured.red('error') },
        { name: 'b', status: coloured.green('ok') },
      ],
      COLUMNS
    )

    const lines = logged[0].split('\n')
    expect(lines).toHaveLength(3) // header + two rows

    // Where the status column begins, measured in visible characters: strip the
    // colour, then drop the first word and the padding after it. If padding had
    // counted ANSI bytes, the coloured rows would disagree with the header.
    const statusOffsets = lines.map((line) => {
      const plain = line.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
      return plain.length - plain.replace(/^\S+\s+/, '').length
    })

    expect(statusOffsets).toEqual([7, 7, 7]) // 'alpha' (5) + 2-space separator
  })

  it('prints the raw rows for json, not the formatted cells', () => {
    printList('json', [{ name: 'alpha', status: 'error' }], COLUMNS)
    expect(JSON.parse(logged[0])).toEqual([{ name: 'alpha', status: 'error' }])
  })

  it('strips colour from text output so cut and awk see plain fields', () => {
    printList('text', [{ name: 'alpha', status: coloured.red('error') }], COLUMNS)
    expect(logged[0]).toBe('alpha\terror')
  })
})

describe('printRecord', () => {
  it.each(['text', 'table'] as const)('sanitizes API-controlled labels in %s output', (format) => {
    printRecord(format, [[`${ESC}]0;pwned${BEL}safe\nlabel`, 'value']], {})

    expect(logged.join('\n')).not.toContain(ESC)
    expect(logged.join('\n')).not.toContain(BEL)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('safe label')
  })
})

describe('sanitize', () => {
  it('removes cursor movement that would overwrite what was already printed', () => {
    expect(sanitize(`before${ESC}[2A${ESC}[2Kafter`)).toBe('beforeafter')
  })

  it('removes non-SGR CSI, which the old SGR-only pattern left executable', () => {
    // The reported hole: stripping only `ESC [ … m` passed everything else through.
    expect(sanitize(`${ESC}[6n`)).toBe('')
    expect(sanitize(`${ESC}[?1049h`)).toBe('')
  })

  it('removes bare C0 and C1 control characters', () => {
    expect(sanitize('a\u0000b\u0008c\u009bd')).toBe('abcd')
  })

  it('removes bidi formatting controls while preserving ordinary RTL text', () => {
    expect(sanitize('safe\u202eevil\u202c \u2066host\u2069 مرحبا')).toBe('safeevil host مرحبا')
  })

  it('normalizes CRLF and removes a lone carriage return that could overwrite a line', () => {
    expect(sanitize('first\r\nsecond\roverwrite')).toBe('first\nsecondoverwrite')
  })

  it('is applied to a table header, not only its cells', () => {
    // A table's column names are user-defined, so the header is remote content
    // too — sanitizing cells alone left the sequences executable one row up.
    const hostile = `${ESC}]0;pwned${BEL}email`
    printList('table', [{ v: 'a@b.co' }], [{ header: hostile, value: () => 'a@b.co' }])
    expect(logged[0]).not.toContain(ESC)
    expect(logged[0]).toContain('EMAIL')
  })
})

describe('cells stay on their own line', () => {
  const rows = [{ note: 'first\nsecond', tabbed: 'a\tb' }]
  const columns: Column<(typeof rows)[number]>[] = [
    { header: 'note', value: (row) => row.note },
    { header: 'tabbed', value: (row) => row.tabbed },
  ]

  function captured(format: 'table' | 'text' | 'json'): string[] {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line)
    })
    printList(format, rows, columns)
    spy.mockRestore()
    return lines
  }

  it('collapses a newline inside a table cell', () => {
    // One newline pushed the rest of the row onto the next line and every
    // column after it lost its alignment.
    const table = captured('table').join('\n')
    expect(table.split('\n')).toHaveLength(2)
    expect(table).toContain('first second')
  })
})
