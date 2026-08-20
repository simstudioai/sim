import { describe, expect, it } from 'vitest'
import {
  comparePrecisionBaseline,
  createPrecisionBaseline,
  effectiveFractionDigits,
  findPrecisionCandidates,
} from './check-icon-path-precision'

const FIXTURE_PATH = '/repo/packages/emcn/src/icons/fixture.tsx'

describe('icon path precision audit', () => {
  it('accepts the two-decimal boundary and ignores geometry outside literal paths', () => {
    const source = `
      const dynamicPath = 'M0.1234 1'
      const unrelated = "d='M0.1234 1'"
      export function SafeIcon() {
        return (
          <svg viewBox='0 0 10.1234 10' transform='scale(0.16624)'>
            <path d='M.5 1.20L1.2e1 2' />
            <path d={dynamicPath} />
          </svg>
        )
      }
    `

    expect(findPrecisionCandidates(source, FIXTURE_PATH)).toEqual([])
  })

  it('finds ordinary decimals and exponents finer than a hundredth', () => {
    const source = `
      export function PreciseIcon() {
        return <svg><path d='M0.123 1e-3L2.34 5' /></svg>
      }
    `

    const candidates = findPrecisionCandidates(source, FIXTURE_PATH)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      icon: 'PreciseIcon',
      maxFractionDigits: 3,
      offendingNumbers: ['0.123', '1e-3'],
    })
    expect(effectiveFractionDigits('2.13949e-05')).toBe(10)
  })

  it('checks literal JSX expressions and static template literals', () => {
    const source = `
      export function ExpressionIcon() {
        return (
          <svg>
            <path d={'M0.123 1'} />
            <path d={\`M2.345 3\`} />
          </svg>
        )
      }
    `

    expect(findPrecisionCandidates(source, FIXTURE_PATH)).toHaveLength(2)
  })

  it('ratchets exact legacy paths and rejects new duplicates', () => {
    const original = `
      export function LegacyIcon() {
        return <svg><path d='M0.123 1' /></svg>
      }
    `
    const originalCandidates = findPrecisionCandidates(original, FIXTURE_PATH)
    const baseline = createPrecisionBaseline(originalCandidates)

    expect(comparePrecisionBaseline(originalCandidates, baseline)).toEqual({
      unbaselined: [],
      staleBaseline: [],
    })

    const duplicate = `
      export function LegacyIcon() {
        return <svg><path d='M0.123 1' /><path d='M0.123 1' /></svg>
      }
    `
    const comparison = comparePrecisionBaseline(
      findPrecisionCandidates(duplicate, FIXTURE_PATH),
      baseline
    )
    expect(comparison.unbaselined).toHaveLength(1)
    expect(comparison.staleBaseline).toEqual([])
  })

  it('makes the baseline stale when legacy debt is changed or removed', () => {
    const original = `
      export function LegacyIcon() {
        return <svg><path d='M0.123 1' /></svg>
      }
    `
    const baseline = createPrecisionBaseline(findPrecisionCandidates(original, FIXTURE_PATH))
    const changed = `
      export function LegacyIcon() {
        return <svg><path d='M0.1234 1' /></svg>
      }
    `

    const changedComparison = comparePrecisionBaseline(
      findPrecisionCandidates(changed, FIXTURE_PATH),
      baseline
    )
    expect(changedComparison.unbaselined).toHaveLength(1)
    expect(changedComparison.staleBaseline).toHaveLength(1)

    const cleaned = original.replace('0.123', '0.12')
    const cleanedComparison = comparePrecisionBaseline(
      findPrecisionCandidates(cleaned, FIXTURE_PATH),
      baseline
    )
    expect(cleanedComparison.unbaselined).toEqual([])
    expect(cleanedComparison.staleBaseline).toHaveLength(1)
  })
})
