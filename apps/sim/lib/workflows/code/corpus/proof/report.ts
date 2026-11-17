/**
 * Collects round-trip outcomes into the JSON report a corpus run writes to `<SUITE>_REPORT_PATH`
 * (the E2E-artifact rule in .claude/rules/sim-testing.md). The headline number is parity per block
 * type: the share of cases containing that type that pass each property, which the 100%
 * per-type parity gate reads. Pure: the caller owns the clock and the file write.
 */

import { compareStrings } from '@sim/utils/string'
import type { Difference } from '@/lib/workflows/code/corpus/proof/diff'

/**
 * The round-trip properties and oracles a corpus run checks. `P0` is P1's source
 * half, `compile(print(c))` equals `c`, which needs no materialize.
 */
const PROOF_PROPERTIES = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'O1', 'O2', 'O3'] as const
export type ProofProperty = (typeof PROOF_PROPERTIES)[number]

type ProofStatus = 'passed' | 'failed' | 'skipped' | 'errored'

interface ProofOutcome {
  caseId: string
  /** Every block type in the case's workflow; each one's parity counts this outcome. */
  blockTypes: string[]
  property: ProofProperty
  status: ProofStatus
  durationMs?: number
  differences?: Difference[]
  /** The skip reason, or the thrown error's message. */
  message?: string
}

interface Tally {
  passed: number
  failed: number
  skipped: number
  errored: number
}

interface BlockTypeParity extends Tally {
  /** `passed / (passed + failed + errored)`; `null` when every outcome was skipped. */
  rate: number | null
}

interface ProofReport {
  suite: string
  /** `incomplete` when nothing failed but some property was skipped wholesale. */
  status: 'passed' | 'failed' | 'incomplete'
  generatedAt: string
  caseCount: number
  totals: Record<ProofProperty, Tally>
  /** Properties skipped wholesale, with the reason. */
  skippedProperties: Array<{ property: ProofProperty; reason: string }>
  /** Block type → property → tally; the per-block-type parity gate. */
  parity: Record<string, Partial<Record<ProofProperty, BlockTypeParity>>>
  /** Failed and errored outcomes, capped at `failureLimit`. */
  failures: ProofOutcome[]
  truncatedFailures: number
}

interface ProofReportCollector {
  record(outcome: ProofOutcome): void
  skipProperty(property: ProofProperty, reason: string): void
  build(options: { generatedAt: string }): ProofReport
}

const emptyTally = (): Tally => ({ passed: 0, failed: 0, skipped: 0, errored: 0 })

/** The env var a suite's report path comes from: `roundtrip-corpus` → `ROUNDTRIP_CORPUS_REPORT_PATH`. */
export function reportPathVariable(suite: string): string {
  return `${suite.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_REPORT_PATH`
}

export function createProofReport(
  suite: string,
  options: { failureLimit?: number } = {}
): ProofReportCollector {
  const failureLimit = options.failureLimit ?? 200
  const outcomes: ProofOutcome[] = []
  const skippedProperties: Array<{ property: ProofProperty; reason: string }> = []

  return {
    record(outcome) {
      outcomes.push(outcome)
    },
    skipProperty(property, reason) {
      skippedProperties.push({ property, reason })
    },
    build({ generatedAt }) {
      const totals = Object.fromEntries(PROOF_PROPERTIES.map((p) => [p, emptyTally()])) as Record<
        ProofProperty,
        Tally
      >
      const parity: ProofReport['parity'] = {}
      const cases = new Set<string>()
      const failures: ProofOutcome[] = []

      for (const outcome of outcomes) {
        cases.add(outcome.caseId)
        totals[outcome.property][outcome.status] += 1
        if (outcome.status === 'failed' || outcome.status === 'errored') failures.push(outcome)
        for (const type of new Set(outcome.blockTypes)) {
          const byProperty = (parity[type] ??= {})
          const tally = (byProperty[outcome.property] ??= { ...emptyTally(), rate: null })
          tally[outcome.status] += 1
          const decided = tally.passed + tally.failed + tally.errored
          tally.rate = decided === 0 ? null : tally.passed / decided
        }
      }

      const sortedParity: ProofReport['parity'] = {}
      for (const type of Object.keys(parity).sort(compareStrings))
        sortedParity[type] = parity[type] ?? {}

      return {
        suite,
        status:
          failures.length > 0 ? 'failed' : skippedProperties.length > 0 ? 'incomplete' : 'passed',
        generatedAt,
        caseCount: cases.size,
        totals,
        skippedProperties,
        parity: sortedParity,
        failures: failures.slice(0, failureLimit),
        truncatedFailures: Math.max(0, failures.length - failureLimit),
      }
    },
  }
}
