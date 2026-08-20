import { describe, expect, it } from 'vitest'
import {
  analyzeIconSource,
  effectiveFractionDigits,
  findNewPrecisionCandidates,
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

    expect(analyzeIconSource(source, FIXTURE_PATH)).toEqual({
      candidates: [],
      invalidExceptions: [],
    })
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

  it('accepts a reasoned TSDoc exception on the immediately following path', () => {
    const source = `
      export function PreciseBrandIcon() {
        return (
          <svg>
            {/**
             * svg-path-precision-exception: Rounding visibly distorts the provider-authored mark.
             */}
            <path d='M0.1234 1' />
          </svg>
        )
      }
    `

    expect(analyzeIconSource(source, FIXTURE_PATH)).toEqual({
      candidates: [],
      invalidExceptions: [],
    })
  })

  it('rejects exceptions without a reason and exceptions on already-clean paths', () => {
    const missingReason = `
      export function PreciseIcon() {
        return <svg>{/** svg-path-precision-exception: */}<path d='M0.123 1' /></svg>
      }
    `
    const unnecessary = `
      export function CleanIcon() {
        return <svg>{/** svg-path-precision-exception: Keep detail. */}<path d='M0.12 1' /></svg>
      }
    `

    const missingReasonAnalysis = analyzeIconSource(missingReason, FIXTURE_PATH)
    expect(missingReasonAnalysis.candidates).toHaveLength(1)
    expect(missingReasonAnalysis.invalidExceptions[0]?.message).toContain('specific reason')

    const unnecessaryAnalysis = analyzeIconSource(unnecessary, FIXTURE_PATH)
    expect(unnecessaryAnalysis.candidates).toEqual([])
    expect(unnecessaryAnalysis.invalidExceptions[0]?.message).toContain('unnecessary')
  })

  it('grandfathers exact paths from the target branch but rejects additions and edits', () => {
    const base = `
      export function LegacyIcon() {
        return <svg><path d='M0.123 1' /></svg>
      }
    `
    const unchanged = findPrecisionCandidates(base, FIXTURE_PATH)
    expect(findNewPrecisionCandidates(unchanged, unchanged)).toEqual([])

    const duplicate = `
      export function LegacyIcon() {
        return <svg><path d='M0.123 1' /><path d='M0.123 1' /></svg>
      }
    `
    expect(
      findNewPrecisionCandidates(findPrecisionCandidates(duplicate, FIXTURE_PATH), unchanged)
    ).toHaveLength(1)

    const changed = base.replace('0.123', '0.1234')
    expect(
      findNewPrecisionCandidates(findPrecisionCandidates(changed, FIXTURE_PATH), unchanged)
    ).toHaveLength(1)
  })

  it('requires a committed exception to remain while its precise path remains', () => {
    const excepted = `
      export function PreciseBrandIcon() {
        return (
          <svg>
            {/** svg-path-precision-exception: Rounding visibly distorts the brand mark. */}
            <path d='M0.1234 1' />
          </svg>
        )
      }
    `
    const exceptionRemoved = excepted.replace(
      '{/** svg-path-precision-exception: Rounding visibly distorts the brand mark. */}',
      ''
    )

    expect(findPrecisionCandidates(excepted, FIXTURE_PATH)).toEqual([])
    expect(
      findNewPrecisionCandidates(findPrecisionCandidates(exceptionRemoved, FIXTURE_PATH), [])
    ).toHaveLength(1)
  })
})
