import chalk, { Chalk } from 'chalk'
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
})

describe('printRecord', () => {
  it('prints the raw object for json, ignoring the field list', () => {
    printRecord('json', [['Name', 'alpha']], { name: 'alpha', hidden: 1 })
    expect(JSON.parse(logged[0])).toEqual({ name: 'alpha', hidden: 1 })
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
