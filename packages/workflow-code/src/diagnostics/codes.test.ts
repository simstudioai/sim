import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_CODES } from './codes'

describe('DIAGNOSTIC_CODES', () => {
  it('each has a row in the SYNTAX.md Diagnostics table, and the table names no other code', () => {
    const syntax = readFileSync(
      path.join(import.meta.dirname, '..', 'compile', 'SYNTAX.md'),
      'utf8'
    )
    const firstCells = [...syntax.matchAll(/^\| (`[EWI]_[A-Z_]+`(?:, `[EWI]_[A-Z_]+`)*) \|/gm)]
    const documented = firstCells.flatMap(([, cell]) =>
      cell.split(', ').map((code) => code.slice(1, -1))
    )
    expect(new Set(documented)).toEqual(new Set(DIAGNOSTIC_CODES))
  })
})
