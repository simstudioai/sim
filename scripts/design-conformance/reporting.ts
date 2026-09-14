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

export function textReport(report: Report): string {
  if (report.status === 'failed')
    return `Design check failed: ${line(report.error ?? 'Operational failure')}\n`
  const counts = findingCounts(report)
  const lines = [
    `Design check: ${report.flagged ? 'findings reported' : 'no new findings'} (${report.policyVersion}).`,
    `Usage violations: ${counts.usage}; system changes: ${counts.system}; unchecked diagnostics: ${report.unchecked.length}.`,
  ]
  for (const [kind, title] of [
    ['usage-violation', 'Usage violations'],
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
  if (report.unchecked.length)
    lines.push(
      'Unchecked inputs remain outside the result; no findings does not prove complete coverage.'
    )
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
  return [
    '### Design conformance',
    '',
    report.status === 'failed'
      ? '**Operational failure. See the check log.**'
      : '**Warning-only rollout:** findings do not block CI.',
    '',
    '| Result | Count |',
    '| --- | ---: |',
    `| Usage violations | ${counts.usage} |`,
    `| Central-system changes | ${counts.system} |`,
    `| Legacy findings | ${counts.legacy} |`,
    `| Unchecked diagnostics | ${report.unchecked.length} |`,
    `| Checked files | ${report.coverage.checkedFiles} |`,
    `| Excluded files | ${report.coverage.excludedFiles} |`,
    '',
    'Full findings and authoritative sources are in the check log. Unchecked inputs do not establish conformance.',
    '',
  ].join('\n')
}
