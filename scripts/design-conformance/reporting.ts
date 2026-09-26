import type { Finding, Report } from '#design-conformance/model'

/** Keep source-authored newlines from becoming terminal workflow commands. */
const line = (value: string) => value.replaceAll('\r', '\\r').replaceAll('\n', '\\n')

export function findingCounts(report: Report) {
  return {
    usage: report.findings.filter((finding) => finding.kind === 'usage-violation').length,
    system: report.findings.filter((finding) => finding.kind === 'system-change').length,
    legacy: report.findings.filter((finding) => !finding.kind).length,
  }
}

function description(finding: Finding): string {
  const parts = [finding.reason, `input: ${finding.provenance?.input ?? finding.value}`]
  if (finding.kind === 'system-change')
    parts.push(
      `${finding.property}: ${JSON.stringify(finding.before ?? null)} → ${JSON.stringify(finding.value)}`
    )
  if (finding.contract) parts.push(`contract: ${finding.contract}`)
  if (finding.provenance) {
    parts.push(`source: ${finding.provenance.source}`, `permitted: ${finding.provenance.permitted}`)
    if (finding.provenance.composition) parts.push(`through: ${finding.provenance.composition}`)
  }
  return parts.join('; ')
}

function uncheckedDescription(note: Report['unchecked'][number]): string {
  return line(
    `${note.file}:${note.line} (${note.side}${note.context ? `; ${note.context}` : ''}) — ${note.reason}`
  )
}

export function textReport(report: Report): string {
  if (report.status === 'failed')
    return [
      `Design check failed: ${line(report.error ?? 'Operational failure')}`,
      ...(report.coverageFailures ?? []).map((note) => `  ${uncheckedDescription(note)}`),
      '',
    ].join('\n')
  const counts = findingCounts(report)
  const lines = [
    `Design check: ${report.flagged ? 'findings reported' : 'no new findings'}${report.unchecked.length ? '; coverage incomplete' : ''} (${report.policyVersion}).`,
    `Product findings: ${counts.usage}; system changes: ${counts.system}; unchecked diagnostics: ${report.unchecked.length}.`,
    `Reviewed decisions: ${report.reviewDecisions?.matches.length ?? 0}; stale decisions: ${report.reviewDecisions?.stale.length ?? 0}; ambiguous decisions: ${report.reviewDecisions?.ambiguous.length ?? 0}.`,
  ]
  for (const [kind, title] of [
    ['usage-violation', 'Product findings'],
    ['system-change', 'Central-system changes — review required'],
    [undefined, 'Legacy policy findings'],
  ] as const) {
    const findings = report.findings.filter((finding) => finding.kind === kind)
    if (!findings.length) continue
    lines.push('', title)
    for (const finding of findings) {
      lines.push(
        `  ${line(finding.file)}:${finding.line}:${finding.column} — ${line(description(finding))}`
      )
    }
  }
  if (report.unchecked.length) {
    lines.push('', 'Unchecked inputs — coverage incomplete')
    for (const note of report.unchecked) lines.push(`  ${uncheckedDescription(note)}`)
    lines.push(
      'Unchecked inputs remain outside the result; no findings does not prove complete coverage.'
    )
  }
  if (report.reviewDecisions?.stale.length || report.reviewDecisions?.ambiguous.length) {
    lines.push('', 'Review decisions requiring renewal')
    for (const fingerprint of report.reviewDecisions.stale) lines.push(`  stale: ${fingerprint}`)
    for (const fingerprint of report.reviewDecisions.ambiguous)
      lines.push(`  ambiguous: ${fingerprint}`)
  }
  return `${lines.join('\n')}\n`
}

/** GitHub workflow-command escaping differs for message data and property values. */
export function escapeAnnotation(value: string, property = false): string {
  const escaped = value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
  return property ? escaped.replaceAll(':', '%3A').replaceAll(',', '%2C') : escaped
}

export function githubAnnotations(report: Report): string[] {
  if (report.status === 'failed')
    return [
      `::error title=Design check failed::${escapeAnnotation(report.error ?? 'Operational failure')}`,
    ]
  return report.findings.map(
    (finding) =>
      `::warning file=${escapeAnnotation(finding.file, true)},line=${Math.max(1, finding.line)},col=${Math.max(1, finding.column)},title=${finding.kind === 'system-change' ? 'Design system review' : 'Design conformance'}::${escapeAnnotation(description(finding))}`
  )
}

export function githubSummary(report: Report): string {
  const counts = findingCounts(report)
  const lines = [
    '### Design conformance',
    '',
    report.status === 'failed'
      ? '**Operational failure. See the check log.**'
      : '**Warning-only rollout:** findings do not block CI.',
    '',
    '| Result | Count |',
    '| --- | ---: |',
    `| Product findings | ${counts.usage} |`,
    `| Central-system changes | ${counts.system} |`,
    `| Legacy findings | ${counts.legacy} |`,
    `| Unchecked diagnostics | ${report.unchecked.length} |`,
    `| Checked files | ${report.coverage.checkedFiles} |`,
    `| Excluded files | ${report.coverage.excludedFiles} |`,
    '',
    'Full findings and authoritative sources are in the check log. Unchecked inputs do not establish conformance.',
    '',
  ]
  if (report.unchecked.length) {
    /** Bound summary size; the check log retains every complete diagnostic. */
    const notes = report.unchecked.slice(0, 100)
    lines.push(
      '<details>',
      `<summary>Unchecked inputs (${report.unchecked.length}) — coverage incomplete</summary>`,
      '',
      `Showing ${notes.length} of ${report.unchecked.length} diagnostics. Long entries are truncated here. Full details are in the check log; these are not design violations.`,
      '',
      '<pre>',
      ...notes.map((note) => {
        const text = uncheckedDescription(note)
        const excerpt =
          text.length > 1000 ? `${text.slice(0, 1000)}… [truncated; see check log]` : text
        /** Source text must not close the HTML block or introduce Markdown formatting. */
        return excerpt.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      }),
      '</pre>',
      '</details>',
      ''
    )
  }
  return lines.join('\n')
}
