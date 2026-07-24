import { type CheckGroup, type Finding, loadCheckContext, runChecks } from './checks.ts'
import { glyph, theme } from './theme.ts'

const GROUP_TITLES: Record<CheckGroup, string> = {
  files: 'Env files',
  schema: 'Schema',
  consistency: 'Consistency',
  coherence: 'Coherence',
  live: 'Live',
}

const GROUP_ORDER: CheckGroup[] = ['files', 'schema', 'consistency', 'coherence', 'live']

function render(findings: Finding[], fixedCount: number): void {
  console.log(`\n${theme.heading('◆ Sim doctor')}\n`)
  for (const group of GROUP_ORDER) {
    const groupFindings = findings.filter((f) => f.group === group)
    if (groupFindings.length === 0) continue
    console.log(theme.heading(GROUP_TITLES[group]))
    for (const finding of groupFindings) {
      console.log(` ${glyph[finding.status]} ${finding.message}`)
      if (finding.fix && finding.status !== 'pass') {
        console.log(`   ${theme.muted(`fix: ${finding.fix}`)}`)
      }
    }
    console.log()
  }
  const counts = {
    pass: findings.filter((f) => f.status === 'pass').length,
    warn: findings.filter((f) => f.status === 'warn').length,
    fail: findings.filter((f) => f.status === 'fail').length,
  }
  const summary = [`${counts.pass} passed`]
  if (counts.warn) summary.push(theme.warn(`${counts.warn} warning${counts.warn > 1 ? 's' : ''}`))
  if (counts.fail) summary.push(theme.error(`${counts.fail} failed`))
  if (fixedCount) summary.push(theme.success(`${fixedCount} fixed`))
  console.log(summary.join(theme.muted(' · ')))
}

export async function runDoctor(options: { fix: boolean; json: boolean }): Promise<number> {
  let findings = await runChecks(loadCheckContext(true))
  let fixedCount = 0
  if (options.fix) {
    const fixable = findings.filter(
      (f) => (f.status === 'fail' || f.status === 'warn') && f.autofix
    )
    for (const finding of fixable) {
      finding.autofix?.()
      fixedCount++
    }
    if (fixedCount > 0) findings = await runChecks(loadCheckContext(true))
  }
  if (options.json) {
    console.log(
      JSON.stringify(
        findings.map(({ autofix: _autofix, ...rest }) => rest),
        null,
        2
      )
    )
  } else {
    render(findings, fixedCount)
  }
  return findings.some((f) => f.status === 'fail') ? 1 : 0
}
