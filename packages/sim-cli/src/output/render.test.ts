import chalk, { Chalk } from 'chalk'
import { load } from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bytes,
  type Column,
  duration,
  printList,
  printRecord,
  sanitize,
  text,
  timestamp,
  visibleWidth,
} from './render'

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

afterEach(() => {
  vi.restoreAllMocks()
})

interface Row {
  name: string
  status: string
}

const COLUMNS: Column<Row>[] = [
  { header: 'name', value: (row) => row.name },
  { header: 'status', value: (row) => row.status },
]

describe('visibleWidth', () => {
  it('ignores ANSI colour codes', () => {
    expect(visibleWidth(coloured.red('error'))).toBe(5)
    expect(visibleWidth(coloured.dim(coloured.green('ok')))).toBe(2)
  })

  it('counts plain text as-is', () => {
    expect(visibleWidth('error')).toBe(5)
  })

  it('sees a wrapped string as wider than nothing but no wider than its text', () => {
    // The regression this guards: a pattern that misses the ESC byte leaves it
    // in the string and inflates the width, drifting every coloured column.
    expect(visibleWidth(coloured.red('x'))).toBe(1)
  })
})

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

  it('says so instead of printing an empty table', () => {
    printList('table', [], COLUMNS)
    expect(logged[0]).toContain('No results.')
  })

  it('prints the raw rows for json, not the formatted cells', () => {
    printList('json', [{ name: 'alpha', status: 'error' }], COLUMNS)
    expect(JSON.parse(logged[0])).toEqual([{ name: 'alpha', status: 'error' }])
  })

  it('can preserve a containing response for machine output', () => {
    const rows = [{ name: 'alpha', status: 'error' }]
    const response = { results: rows, totalResults: 1 }
    printList('json', rows, COLUMNS, response)
    expect(JSON.parse(logged[0])).toEqual(response)
  })

  it('prints the raw rows for yaml too', () => {
    printList('yaml', [{ name: 'alpha', status: 'error' }], COLUMNS)
    expect(load(logged[0])).toEqual([{ name: 'alpha', status: 'error' }])
  })

  it('keeps machine formats identical in content — only the encoding differs', () => {
    const rows = [{ name: 'alpha', status: 'error' }]
    printList('json', rows, COLUMNS)
    printList('yaml', rows, COLUMNS)
    expect(load(logged[1])).toEqual(JSON.parse(logged[0]))
  })

  it('does not fold long yaml values across lines', () => {
    // Folding is valid YAML but breaks line-oriented greps and is miserable to read.
    const long = 'x'.repeat(300)
    printList('yaml', [{ name: long, status: 'ok' }], COLUMNS)
    expect(logged[0]).toContain(long)
  })

  it('emits tab-separated cells with no header for text', () => {
    printList(
      'text',
      [
        { name: 'alpha', status: 'error' },
        { name: 'b', status: 'ok' },
      ],
      COLUMNS
    )
    expect(logged).toEqual(['alpha\terror', 'b\tok'])
  })

  it('strips colour from text output so cut and awk see plain fields', () => {
    printList('text', [{ name: 'alpha', status: coloured.red('error') }], COLUMNS)
    expect(logged[0]).toBe('alpha\terror')
  })

  it('renders an absent value as an empty text field, not a dash', () => {
    // `cut -f2` returning a literal em-dash would read as a value to every
    // downstream emptiness test.
    printList('text', [{ name: 'alpha', status: text(null) }], COLUMNS)
    expect(logged[0]).toBe('alpha\t')
  })

  it('prints nothing at all for an empty text list', () => {
    printList('text', [], COLUMNS)
    expect(logged).toEqual([])
  })
})

describe('printRecord', () => {
  it('prints the raw object for json, ignoring the field list', () => {
    printRecord('json', [['Name', 'alpha']], { name: 'alpha', hidden: 1 })
    expect(JSON.parse(logged[0])).toEqual({ name: 'alpha', hidden: 1 })
  })

  it('prints the raw object for yaml, ignoring the field list', () => {
    printRecord('yaml', [['Name', 'alpha']], { name: 'alpha', hidden: 1 })
    expect(load(logged[0])).toEqual({ name: 'alpha', hidden: 1 })
  })

  it('prints label-tab-value for text', () => {
    printRecord('text', [['ID', 'abc']], {})
    expect(logged[0]).toBe('ID\tabc')
  })

  it('prints one aligned line per field for table', () => {
    printRecord(
      'table',
      [
        ['ID', 'abc'],
        ['Name', 'alpha'],
      ],
      {}
    )
    expect(logged).toHaveLength(2)
    expect(logged[0]).toContain('abc')
    expect(logged[1]).toContain('alpha')
  })

  it('clamps a very wide value in table mode only', () => {
    // A signed download URL is the whole point of the command that prints it;
    // clamping it before the format branch corrupted `text`, silently.
    const url = `https://example.com/${'a'.repeat(400)}`
    printRecord('table', [['url', url]], {})
    printRecord('text', [['url', url]], {})

    expect(logged[0]).toMatch(/…$/)
    expect(logged[0].length).toBeLessThan(url.length)
    expect(logged[1]).toBe(`url\t${url}`)
  })

  it.each(['text', 'table'] as const)('sanitizes API-controlled labels in %s output', (format) => {
    printRecord(format, [[`${ESC}]0;pwned${BEL}safe\nlabel`, 'value']], {})

    expect(logged.join('\n')).not.toContain(ESC)
    expect(logged.join('\n')).not.toContain(BEL)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('safe label')
  })
})

describe('formatters', () => {
  it('renders absent values as a dash rather than "null"', () => {
    for (const value of [null, undefined, '']) {
      expect(visibleWidth(text(value))).toBe(1)
      expect(chalk.reset(text(value))).not.toContain('null')
    }
  })

  it('scales bytes to a readable unit', () => {
    expect(bytes(512)).toBe('512 B')
    expect(bytes(2048)).toBe('2.0 KB')
    expect(bytes(0)).toBe('0 B')
  })

  it('scales durations across the ms/s/m boundaries', () => {
    expect(duration(999)).toBe('999ms')
    expect(duration(1500)).toBe('1.5s')
    expect(duration(90_000)).toBe('1m30s')
  })

  it('rounds the high-resolution milliseconds the API reports', () => {
    expect(duration(9.145596999907866)).toBe('9ms')
  })
})

describe('sanitize', () => {
  // Remote content — knowledge document text, table cell values, workflow names —
  // reaches an interactive terminal through the human-readable renderers.
  it('removes an OSC window-title sequence', () => {
    expect(sanitize(`${ESC}]0;pwned\u0007hello`)).toBe('hello')
  })

  it('removes OSC terminated by ST rather than BEL', () => {
    expect(sanitize(`${ESC}]0;pwned${ESC}\\hello`)).toBe('hello')
  })

  it('removes cursor movement that would overwrite what was already printed', () => {
    expect(sanitize(`before${ESC}[2A${ESC}[2Kafter`)).toBe('beforeafter')
  })

  it('removes a full terminal reset', () => {
    expect(sanitize(`${ESC}creset`)).toBe('reset')
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

  it('takes the following byte with a bare ESC, since ESC + printable is a sequence', () => {
    expect(sanitize('a\u001bdb')).toBe('ab')
  })

  it('keeps tabs and newlines, which are legitimate content', () => {
    expect(sanitize('a\tb\nc')).toBe('a\tb\nc')
  })

  it('normalizes CRLF and removes a lone carriage return that could overwrite a line', () => {
    expect(sanitize('first\r\nsecond\roverwrite')).toBe('first\nsecondoverwrite')
  })

  it('leaves ordinary text untouched', () => {
    expect(sanitize('refund policy — 30 days')).toBe('refund policy — 30 days')
  })

  it('is applied to values passing through text()', () => {
    expect(text(`${ESC}]0;x\u0007safe`)).toBe('safe')
  })

  it('is applied to a table header, not only its cells', () => {
    // A table's column names are user-defined, so the header is remote content
    // too — sanitizing cells alone left the sequences executable one row up.
    const hostile = `${ESC}]0;pwned${BEL}email`
    printList('table', [{ v: 'a@b.co' }], [{ header: hostile, value: () => 'a@b.co' }])
    expect(logged[0]).not.toContain(ESC)
    expect(logged[0]).toContain('EMAIL')
  })

  it('is applied to an unparseable timestamp, which is echoed verbatim', () => {
    // The invalid-date branch returns the server's own string, so it was a way
    // past every other formatter.
    expect(timestamp(`${ESC}]0;pwned\u0007not-a-date`)).toBe('not-a-date')
  })

  it('still formats a valid timestamp normally', () => {
    expect(timestamp('2026-07-31T09:14:22.500Z')).toBe('2026-07-31 09:14:22')
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

  it('collapses a tab in text mode, so cut -f still sees real fields', () => {
    const [line] = captured('text')
    expect(line.split('\t')).toHaveLength(2)
    expect(line).toBe('first second\ta b')
  })

  it('leaves json untouched', () => {
    expect(JSON.parse(captured('json').join('\n'))).toEqual([
      { note: 'first\nsecond', tabbed: 'a\tb' },
    ])
  })

  it('clamps a very wide cell in table mode only', () => {
    const wide = [{ blob: 'x'.repeat(500) }]
    const cols: Column<(typeof wide)[number]>[] = [{ header: 'blob', value: (row) => row.blob }]
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line)
    })
    printList('table', wide, cols)
    printList('text', wide, cols)
    spy.mockRestore()

    // The table arrives as one string: header line, then the clamped body line.
    const [header, body] = lines[0].split('\n')
    expect(header.trim()).toBe('BLOB')
    expect(body).toMatch(/…$/)
    expect(body.length).toBeLessThan(100)
    // `text` feeds pipelines; truncating there would corrupt the data.
    expect(lines[1]).toHaveLength(500)
  })
})
