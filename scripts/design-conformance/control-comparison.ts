import { compareStrings } from '@sim/utils/string'
import { inspectControlAnalysis } from '#control-analysis/analysis'
import {
  removedColourAliasFindings,
  withoutVerifiedColourUsages,
} from '#control-analysis/colour-assignments'
import { classifyLayout } from '#control-analysis/layout-allowances'
import type { ControlSource } from '#control-analysis/model'
import { mergeSourceFindings } from '#control-analysis/review'
import { productScope } from '#control-analysis/scope'
import { centralInventory } from '#design-conformance/contracts'
import { generateContracts } from '#design-conformance/generated-contracts'
import {
  type Change,
  canonical,
  findingFingerprint,
  inspectionFailure,
  introducedFindings as matchIntroducedFindings,
  type Report,
} from '#design-conformance/model'
import { snapshotHash } from '#design-conformance/system-snapshot'
import { GitSource } from '#design-conformance/worktree-source'

/** Source is immutable Git data, including unchanged dependencies; never loaded as modules. */
export function controlSource(repo: string, commit: string): ControlSource {
  if (!/^[a-f\d]{40}$/.test(commit))
    throw new Error('Control analysis requires an immutable commit')
  const source = new GitSource(repo, commit)
  source.prefetchProduct()
  return source
}

/** Compare authored occurrences; unchanged debt never licenses an additional copy. */
export const introducedFindings = <T extends import('#design-conformance/model').Finding>(
  before: { findings: T[] },
  after: { findings: T[] }
) => matchIntroducedFindings(before.findings, after.findings)

/** Both public conformance commands call this analyzer; CI only formats its ordinary findings. */
export async function addControlComparison(
  report: Report,
  changes: Change[],
  before: () => ControlSource,
  after: () => ControlSource
): Promise<Report> {
  if (
    report.status !== 'completed' ||
    !changes.some((c) => [c.before, c.after].some((e) => e && productScope(e.path) === 'check'))
  )
    return report
  const inspect = async (source: ControlSource) => {
    const entries = source.entries.filter((entry) => centralInventory(entry.path))
    const metadata = await generateContracts({
      snapshot: { version: '1.0.0', commit: '', entries, hash: snapshotHash(entries) },
      read: (entry) => source.read(entry),
    })
    return inspectControlAnalysis(source, 'forward', undefined, metadata)
  }
  const beforeAnalysis = await inspect(before())
  const afterAnalysis = await inspect(after())
  for (const [side, analysis] of [
    ['before', beforeAnalysis],
    ['after', afterAnalysis],
  ] as const) {
    const paths = new Set(
      changes.flatMap((change) => {
        const entry = side === 'before' ? change.before : change.after
        return entry && productScope(entry.path) === 'check' ? [entry.path] : []
      })
    )
    for (const note of [
      ...analysis.controls.unchecked,
      ...analysis.colourAssignments.unchecked,
      ...analysis.review.unchecked,
    ]) {
      if (!paths.has(note.file) || !inspectionFailure(note)) continue
      report.coverageFailures ??= []
      if (
        !report.coverageFailures.some(
          (existing) =>
            existing.file === note.file && existing.side === side && existing.reason === note.reason
        )
      )
        report.coverageFailures.push({ ...note, side })
    }
  }
  const colourFindings = introducedFindings(
    beforeAnalysis.colourAssignments,
    afterAnalysis.colourAssignments
  )
  report.findings.push(...colourFindings)
  report.findings = mergeSourceFindings(
    report.findings,
    introducedFindings(beforeAnalysis.review, afterAnalysis.review)
  )
  const existingReviewNotes = new Set(
    beforeAnalysis.review.unchecked.map((note) => canonical([note.file, note.context, note.reason]))
  )
  report.unchecked.push(
    ...afterAnalysis.review.unchecked
      .filter((note) => !existingReviewNotes.has(canonical([note.file, note.context, note.reason])))
      .map((note) => ({ ...note, side: 'after' }))
  )
  report.findings = withoutVerifiedColourUsages(report.findings, afterAnalysis.colourAssignments)
  for (const finding of removedColourAliasFindings(
    beforeAnalysis.colourAssignments,
    afterAnalysis.colourAssignments
  )) {
    if (
      !report.findings.some(
        (existing) =>
          existing.rule === finding.rule &&
          existing.file === finding.file &&
          existing.line === finding.line &&
          existing.property === finding.property
      )
    )
      report.findings.push(finding)
  }
  const layout = classifyLayout(report.findings)
  report.findings = layout.findings
  report.layoutAllowances = layout.allowances
  report.findings.sort((x, y) =>
    compareStrings(
      canonical([x.file, x.line, x.column, x.rule, x.value]),
      canonical([y.file, y.line, y.column, y.rule, y.value])
    )
  )
  report.unchecked.push(
    ...beforeAnalysis.colourAssignments.unchecked.map((n) => ({ ...n, side: 'before' })),
    ...afterAnalysis.colourAssignments.unchecked.map((n) => ({ ...n, side: 'after' }))
  )
  report.colourAssignments = {
    version: '1.0.0',
    before: beforeAnalysis.colourAssignments.coverage,
    after: afterAnalysis.colourAssignments.coverage,
    introduced: colourFindings.length,
    verifiedUsages: afterAnalysis.colourAssignments.verifiedUsages,
  }
  report.coverage.violations = report.findings.filter((f) => f.kind === 'usage-violation').length
  report.findings = report.findings.map((finding) => ({
    ...finding,
    identity: findingFingerprint(finding),
  }))
  report.flagged = report.findings.length > 0
  if (report.coverageFailures?.length) {
    report.status = 'failed'
    report.flagged = null
    report.error = `${report.coverageFailures.length} changed product file inspection failure(s); comparison incomplete`
  }
  return report
}
