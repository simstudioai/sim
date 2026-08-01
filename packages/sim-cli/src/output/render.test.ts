import chalk, { Chalk } from 'chalk'
import { load } from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bytes,
  type Column,
  duration,
  printList,
  printRecord,
  text,
  visibleWidth,
} from './render.js'

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
})
