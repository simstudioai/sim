import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DIAGNOSTIC_CODES } from '@sim/workflow-code/diagnostics/codes'
import { describe, expect, it } from 'vitest'

describe('the Diagnostics table the README points at', () => {
  it('has a SYNTAX.md row for every diagnostic code, and names no other code', () => {
    const syntax = readFileSync(
      path.join(import.meta.dirname, '../../workflow-code/src/compile/SYNTAX.md'),
      'utf8'
    )
    const firstCells = [...syntax.matchAll(/^\| (`[EWI]_[A-Z_]+`(?:, `[EWI]_[A-Z_]+`)*) \|/gm)]
    const documented = firstCells.flatMap(([, cell]) =>
      cell.split(', ').map((code) => code.slice(1, -1))
    )
    expect(new Set(documented)).toEqual(new Set(DIAGNOSTIC_CODES))
  })
})
