/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  FUNCTION_E2B_DEFAULT_BASE_TEMPLATE,
  functionE2BBaseTemplate,
  functionE2BReleaseGeneration,
} from '@/scripts/function-e2b-release'

describe('Function E2B release generation', () => {
  it('defaults to the injected release time', () => {
    expect(functionE2BReleaseGeneration([], undefined, 101)).toBe(101)
  })

  it('rejects malformed explicit generation arguments', () => {
    expect(() => functionE2BReleaseGeneration(['--generation'], '100', 101)).toThrow(
      '--generation must be a positive safe integer'
    )
    expect(() => functionE2BReleaseGeneration(['--generation', '--no-cache'], '100', 101)).toThrow(
      '--generation must be a positive safe integer'
    )
  })

  it('accepts a valid first release generation', () => {
    expect(functionE2BReleaseGeneration(['--generation', '101'])).toBe(101)
  })

  it('requires a generation above the configured release', () => {
    expect(functionE2BReleaseGeneration(['--generation', '101'], '100')).toBe(101)
    expect(() => functionE2BReleaseGeneration(['--generation', '100'], '100')).toThrow(
      'must be greater'
    )
    expect(() => functionE2BReleaseGeneration(['--generation', '99'], '100')).toThrow(
      'must be greater'
    )
  })

  it('rejects an invalid configured release floor', () => {
    expect(() => functionE2BReleaseGeneration(['--generation', '101'], 'latest')).toThrow(
      'Configured E2B_FUNCTION_TEMPLATE_GENERATION'
    )
  })
})

describe('Function E2B base template', () => {
  it('uses the maintained E2B code-interpreter base by default', () => {
    expect(functionE2BBaseTemplate([])).toBe(FUNCTION_E2B_DEFAULT_BASE_TEMPLATE)
  })

  it('accepts an explicit immutable base override', () => {
    expect(
      functionE2BBaseTemplate([
        '--base-template',
        'sim-function-source:0cc50c4d-951d-4982-a131-3f0ae022d8d2',
      ])
    ).toBe('sim-function-source:0cc50c4d-951d-4982-a131-3f0ae022d8d2')
  })

  it('rejects missing or mutable base overrides', () => {
    expect(() => functionE2BBaseTemplate(['--base-template'])).toThrow(
      '--base-template must be an immutable E2B build reference'
    )
    expect(() => functionE2BBaseTemplate(['--base-template', 'code-interpreter-v1'])).toThrow(
      '--base-template must be an immutable E2B build reference'
    )
  })
})
