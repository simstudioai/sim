/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { parseTaxBooleanInput, parseTaxJsonInput } from '@/tools/oracle_epm_tax_reporting/utils'

describe('Tax Reporting resolved parameter conversion', () => {
  it('rejects oversized serialized JSON before parsing it', () => {
    expect(() => parseTaxJsonInput(' '.repeat(2 * 1024 * 1024 + 1), 'Grid')).toThrow('2 MiB')
    expect(() => parseTaxJsonInput(`{"value":"${'税'.repeat(750000)}"}`, 'Grid')).toThrow('2 MiB')
  })

  it('parses JSON without rewriting tenant prompt names or member references inside values', () => {
    expect(parseTaxJsonInput('{"Rule (2).Entity":"<trigger.entity>"}', 'Prompts')).toEqual({
      'Rule (2).Entity': '<trigger.entity>',
    })
    const grid = { pov: ['Actual'], rows: [], columns: [] }
    expect(parseTaxJsonInput(grid, 'Grid')).toBe(grid)
    expect(parseTaxJsonInput('', 'Grid')).toBeUndefined()
    expect(() => parseTaxJsonInput('{bad', 'Grid')).toThrow('Grid must be valid JSON')
  })
  it('distinguishes false from missing and refuses invalid booleans', () => {
    expect(parseTaxBooleanInput(false)).toBe(false)
    expect(parseTaxBooleanInput('false')).toBe(false)
    expect(parseTaxBooleanInput('true')).toBe(true)
    expect(parseTaxBooleanInput('')).toBeUndefined()
    expect(() => parseTaxBooleanInput('yes')).toThrow()
  })
})
