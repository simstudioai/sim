/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { validateRegex, validateRegexPattern } from '@/lib/guardrails/validate_regex'

describe('validateRegex', () => {
  it('passes when the input matches', () => {
    expect(validateRegex('order 12345 shipped', '\\d{5}')).toEqual({ passed: true })
  })

  it('fails with a reason when the input does not match', () => {
    expect(validateRegex('no digits', '\\d{5}')).toEqual({
      passed: false,
      error: 'Input does not match regex pattern',
    })
  })

  it('runs a catastrophic pattern in linear time', () => {
    // Both the guardrail pattern and the text it checks are caller-influenced,
    // and this executes on the shared event loop. `a*a*b` against this input
    // measured 213s on JSC before the engine change.
    const start = Date.now()
    const result = validateRegex(`${'a'.repeat(10000)}!`, 'a*a*b')

    expect(Date.now() - start).toBeLessThan(2000)
    expect(result.passed).toBe(false)
  })

  it('reports syntax RE2 cannot evaluate rather than running it', () => {
    const result = validateRegex('anything', '(?=foo)bar')
    expect(result.passed).toBe(false)
    expect(result.error).toContain('lookahead')
  })

  it('reports invalid syntax distinctly from unsupported syntax', () => {
    const result = validateRegex('anything', '(')
    expect(result.passed).toBe(false)
    expect(result.error).toContain('Invalid regex pattern')
  })
})

describe('validateRegexPattern', () => {
  it('accepts a valid pattern', () => {
    expect(validateRegexPattern('\\d{3}-\\d{4}')).toEqual({ valid: true })
  })

  it('rejects an empty pattern', () => {
    expect(validateRegexPattern('')).toMatchObject({ valid: false })
  })

  it('rejects invalid syntax', () => {
    expect(validateRegexPattern('(')).toMatchObject({ valid: false })
  })

  it('is unchanged by the RE2 migration — patterns here go to Presidio, not this process', () => {
    // Left on `safe-regex2` deliberately: these patterns execute in Presidio,
    // where a slow one times out rather than stalling this event loop, and
    // Presidio's Python engine supports constructs RE2 does not.
    expect(validateRegexPattern('(?:https?://)?example\\.com')).toMatchObject({ valid: false })
    expect(validateRegexPattern('(?<=id: )\\w+')).toMatchObject({ valid: false })
  })
})
