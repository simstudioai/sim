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

  it.each([
    ['lookbehind', '(?<=id: )\\w+'],
    ['optional group', '(?:https?://)?example\\.com'],
    ['nested quantifier', '(a+)+$'],
  ])('accepts %s, which the removed safe-regex2 screen rejected', (_label, pattern) => {
    // These are valid Presidio patterns that could not be saved before. The
    // screen that blocked them caught no real ReDoS (it passes `a*a*b`), and
    // these run in Presidio rather than in this process.
    expect(validateRegexPattern(pattern)).toEqual({ valid: true })
  })
})
