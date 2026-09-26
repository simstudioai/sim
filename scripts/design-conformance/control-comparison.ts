import { execFileSync } from 'node:child_process'
import {
  removedColourAliasFindings,
  withoutVerifiedColourUsages,
} from '#control-analysis/colour-assignments'
import { classifyLayout } from '#control-analysis/layout-allowances'
import type { ControlSource, SourceEntry } from '#control-analysis/model'
import { productScope } from '#control-analysis/scope'
import { mergeShadowFindings, withoutApprovedShadows } from '#control-analysis/shadow-extras'
import { inspectSimplifications } from '#control-analysis/simplifications'
import { classifyTypography } from '#control-analysis/typography'
import { git, verifiedText } from '#design-conformance/io'
import { type Change, canonical, type Finding, type Report } from '#design-conformance/model'

/** Source is immutable Git data, including unchanged dependencies; never loaded as modules. */
export function controlSource(repo: string, commit: string): ControlSource {
  if (!/^[a-f\d]{40}$/.test(commit))
    throw new Error('Control analysis requires an immutable commit')
  const entries: SourceEntry[] = git(repo, ['ls-tree', '-r', '-l', '-z', '--full-tree', commit])
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t')
      const [mode, kind, blob, bytes] = line.slice(0, tab).trim().split(/\s+/)
      return {
        path: line.slice(tab + 1),
        mode,
        kind,
        blob,
        bytes: bytes === '-' ? 0 : Number(bytes),
      }
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const known = new Map(entries.map((e) => [e.path, e]))
  const blobs = new Map<string, string>()
  const readable = entries.filter(
    (e) =>
      /^100(?:644|755)$/.test(e.mode) &&
      e.bytes <= 2 * 1024 * 1024 &&
      /\.[cm]?[jt]sx?$|\.html?$|\.css$/.test(e.path) &&
      productScope(e.path) === 'check'
  )
  /** Bounded batch reads avoid one Git process per module while verifying every blob. */
  for (let start = 0; start < readable.length; start += 100) {
    const batch = readable.slice(start, start + 100)
    const data = execFileSync(
      'git',
      ['--no-pager', '--no-replace-objects', 'cat-file', '--batch'],
      {
        cwd: repo,
        input: `${batch.map((e) => e.blob).join('\n')}\n`,
        maxBuffer: 210 * 1024 * 1024,
        env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1' },
      }
    )
    let offset = 0
    for (const entry of batch) {
      const newline = data.indexOf(10, offset)
      const [blob, kind, bytes] = data.subarray(offset, newline).toString().split(' ')
      if (
        newline < offset ||
        blob !== entry.blob ||
        kind !== 'blob' ||
        Number(bytes) !== entry.bytes
      )
        throw new Error('Invalid control source batch')
      offset = newline + 1
      blobs.set(blob, verifiedText(data.subarray(offset, offset + entry.bytes), blob))
      offset += entry.bytes + 1
    }
    if (offset !== data.length) throw new Error('Unexpected control source batch data')
  }
  return {
    entries,
    read(entry) {
      const actual = known.get(entry.path)
      if (
        !actual ||
        actual.blob !== entry.blob ||
        !/^100(?:644|755)$/.test(actual.mode) ||
        actual.bytes > 2 * 1024 * 1024
      )
        throw new Error(`Unavailable control source: ${entry.path}`)
      return (
        blobs.get(entry.blob) ??
        verifiedText(git(repo, ['cat-file', 'blob', entry.blob]), entry.blob)
      )
    },
    readOwnership(entry) {
      const actual = known.get(entry.path)
      if (
        !actual ||
        actual.blob !== entry.blob ||
        !/^100(?:644|755)$/.test(actual.mode) ||
        actual.bytes > 16 * 1024 * 1024
      )
        throw new Error(`Unavailable ownership source: ${entry.path}`)
      const text =
        blobs.get(entry.blob) ??
        verifiedText(git(repo, ['cat-file', 'blob', entry.blob]), entry.blob)
      blobs.set(entry.blob, text)
      return text
    },
  }
}

/** Compare authored occurrences; unchanged debt never licenses an additional copy. */
export function compareSimplifications<T extends Finding>(
  before: { findings: T[] },
  after: { findings: T[] }
) {
  const key = (f: T) => canonical([f.file, f.context, f.rule, f.value])
  const counts = new Map<string, number>()
  for (const f of before.findings) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1)
  return after.findings.filter((f) => {
    const count = counts.get(key(f)) ?? 0
    if (!count) return true
    counts.set(key(f), count - 1)
    return false
  })
}

/** Both public conformance commands call this analyzer; CI only formats its ordinary findings. */
export function addControlComparison(
  report: Report,
  changes: Change[],
  before: () => ControlSource,
  after: () => ControlSource
): Report {
  if (
    report.status !== 'completed' ||
    !changes.some((c) => [c.before, c.after].some((e) => e && productScope(e.path) === 'check'))
  )
    return report
  const beforeAnalysis = inspectSimplifications(before())
  const afterAnalysis = inspectSimplifications(after())
  const b = beforeAnalysis.simplifications
  const a = afterAnalysis.simplifications
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
      if (
        !paths.has(note.file) ||
        !/^(?:Parser failure|Extraction failure|Source exceeds|CSS (?:colour assignments|parse)|Native-control CSS review could not parse)/.test(
          note.reason
        )
      )
        continue
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
  const findings = compareSimplifications(b, a)
  const colourFindings = compareSimplifications(
    beforeAnalysis.colourAssignments,
    afterAnalysis.colourAssignments
  )
  report.findings.push(...findings, ...colourFindings)
  const existingChrome = new Map<string, number>()
  const chromeKey = (finding: Finding) =>
    canonical([finding.file, finding.line, finding.rule, finding.property, finding.value])
  for (const finding of report.findings) {
    const key = chromeKey(finding)
    existingChrome.set(key, (existingChrome.get(key) ?? 0) + 1)
  }
  for (const finding of compareSimplifications(beforeAnalysis.review, afterAnalysis.review)) {
    const key = chromeKey(finding)
    const existing = existingChrome.get(key) ?? 0
    if (existing) existingChrome.set(key, existing - 1)
    else report.findings.push(finding)
  }
  const existingReview = new Set(beforeAnalysis.review.items.map((item) => item.id))
  report.reviewItems = afterAnalysis.review.items.filter((item) => !existingReview.has(item.id))
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
  report.findings = mergeShadowFindings(
    withoutApprovedShadows(report.findings, afterAnalysis.shadowExtras),
    compareSimplifications(beforeAnalysis.shadowExtras, afterAnalysis.shadowExtras)
  )
  report.findings = classifyTypography(report.findings, afterAnalysis.typographyReview)
  const layout = classifyLayout(report.findings)
  report.findings = layout.findings
  report.layoutAllowances = layout.allowances
  report.typographyReview = afterAnalysis.typographyReview
  report.shadowExtras = afterAnalysis.shadowExtras.approved
  report.unchecked.push(
    ...beforeAnalysis.shadowExtras.unchecked.map((n) => ({ ...n, side: 'before' })),
    ...afterAnalysis.shadowExtras.unchecked.map((n) => ({ ...n, side: 'after' }))
  )
  report.findings.sort((x, y) =>
    canonical([x.file, x.line, x.column, x.rule, x.value]).localeCompare(
      canonical([y.file, y.line, y.column, y.rule, y.value])
    )
  )
  report.unchecked.push(
    ...b.unchecked.map((n) => ({ ...n, side: 'before' })),
    ...a.unchecked.map((n) => ({ ...n, side: 'after' }))
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
  report.controlSimplifications = {
    version: '1.0.0',
    before: b.coverage,
    after: a.coverage,
    existingBefore: b.findings.length,
    existingAfter: a.findings.length,
    introduced: findings.length,
    unresolved: a.unchecked.length,
  }
  report.coverage.violations = report.findings.filter((f) => f.kind === 'usage-violation').length
  report.flagged = report.findings.length > 0
  if (report.coverageFailures?.length) {
    report.status = 'failed'
    report.flagged = null
    report.error = `${report.coverageFailures.length} changed product file inspection failure(s); comparison incomplete`
  }
  return report
}
