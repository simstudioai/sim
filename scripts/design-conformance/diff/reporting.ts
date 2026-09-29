import type { Finding, Report } from '#design-conformance/shared/model'

/** Keep source-authored newlines from becoming terminal workflow commands. */
const line = (value: string) => value.replaceAll('\r', '\\r').replaceAll('\n', '\\n')
const bounded = (value: string, limit = 1000) =>
  value.length > limit ? `${value.slice(0, limit)}… [truncated; see JSON]` : value

export function findingCounts(report: Report) {
  return {
    usage: report.findings.filter((finding) => finding.kind === 'usage-violation').length,
    system: report.findings.filter((finding) => finding.kind === 'system-change').length,
  }
}

function description(finding: Finding): string {
  const parts = [bounded(finding.reason, 250)]
  if (finding.contract) parts.push(`contract: ${bounded(finding.contract, 160)}`)
  if (finding.provenance) {
    parts.push(
      `source: ${bounded(finding.provenance.source, 180)}`,
      `permitted: ${bounded(finding.provenance.permitted, 180)}`
    )
    if (finding.provenance.composition)
      parts.push(`through: ${bounded(finding.provenance.composition, 120)}`)
  }
  parts.push(`input: ${bounded(finding.provenance?.input ?? finding.value, 180)}`)
  if (finding.kind === 'system-change')
    parts.push(
      `${finding.property}: ${bounded(JSON.stringify(finding.before ?? null), 180)} → ${bounded(JSON.stringify(finding.value), 180)}`
    )
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
  ]
  for (const [kind, title] of [
    ['usage-violation', 'Product findings'],
    ['system-change', 'Central-system changes — review required'],
  ] as const) {
    const findings = report.findings.filter((finding) => finding.kind === kind)
    if (!findings.length) continue
    lines.push('', title)
    for (const finding of findings) {
      lines.push(
        `  ${line(finding.file)}:${finding.line}:${finding.column} — ${bounded(line(description(finding)))}`
      )
    }
  }
  if (report.unchecked.length) {
    const relevant = report.unchecked.filter((note) => note.relevant)
    lines.push(
      '',
      `Unchecked inputs — ${relevant.length} changed or introduced; ${report.unchecked.length - relevant.length} baseline`
    )
    for (const note of relevant.slice(0, 20)) {
      const description = uncheckedDescription(note)
      lines.push(`  ${bounded(description)}`)
    }
    lines.push(
      `Showing ${Math.min(relevant.length, 20)} of ${report.unchecked.length} unchecked diagnostics. Rerun the same bun run check:design command with --format json to print the complete report, or --output /tmp/design-check.json to save it. No findings does not prove complete coverage.`
    )
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
      `::warning file=${escapeAnnotation(finding.file, true)},line=${Math.max(1, finding.line)},col=${Math.max(1, finding.column)},title=${finding.kind === 'system-change' ? 'Design system review' : 'Design conformance'}::${escapeAnnotation(bounded(description(finding)))}`
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
    `| Unchecked diagnostics | ${report.unchecked.length} |`,
    `| Checked files | ${report.coverage.checkedFiles} |`,
    `| Excluded files | ${report.coverage.excludedFiles} |`,
    '',
    'Full findings and authoritative sources are in the JSON artifact. Unchecked inputs do not establish conformance.',
    '',
  ]
  if (report.unchecked.length) {
    const relevant = report.unchecked.filter((note) => note.relevant)
    const notes = relevant.slice(0, 20)
    lines.push(
      '<details>',
      `<summary>Unchecked inputs (${relevant.length} changed or introduced; ${report.unchecked.length - relevant.length} baseline)</summary>`,
      '',
      `Showing ${notes.length} of ${report.unchecked.length} diagnostics. Long entries are truncated here. Full details are in the JSON artifact; these are not design violations.`,
      '',
      '<pre>',
      ...notes.map((note) => {
        const text = uncheckedDescription(note)
        const excerpt = text.length > 1000 ? `${text.slice(0, 1000)}… [truncated; see JSON]` : text
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
