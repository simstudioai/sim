#!/usr/bin/env bun
/**
 * Keeps the Platform's parity ledger honest. `apps/sim/platform/docs/org-parity.md` is what the
 * organization rollout is judged on, so a row marked Done has to point at something that exists: a
 * live spec's test by its quoted title, or an integration or unit test file. Anything built on live
 * data without such a check is `Unverified`, and says why.
 *
 * With `--report <playwright.json>` (repeatable) it also reads what that run did: a row whose
 * proving test failed or was skipped is not Done, whatever the ledger says.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

const STATUSES = new Set(['Done', 'Done, not copied', 'Unverified', 'Legacy', 'Hidden', 'Open'])
const HEADERS = new Set([
  'Domain|Capability|Legacy source|Status|Proof or reason',
  'Capability|Legacy source|Status|Proof or reason',
])
const FILE_PROOF = /[\w./-]+\.(?:integration\.ts|test\.tsx?|spec\.ts)/g
const TITLE_PROOF = /"([^"]+)"/g

/** Test title to its worst status in a run. */
type RunOutcome = Map<string, string>

interface LedgerInputs {
  ledger: string
  /** Base names of every test file in the app. */
  testFiles: ReadonlySet<string>
  /** Titles of every test in the live specs. */
  liveTitles: readonly string[]
  run?: RunOutcome
}

function cells(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim())
}

function matchingTitles(quoted: string, titles: Iterable<string>): string[] {
  const needle = quoted.toLowerCase()
  return [...titles].filter((title) => title.toLowerCase().includes(needle))
}

function isLiveSpec(file: string): boolean {
  return file.endsWith('.spec.ts') && file.includes('checks/')
}

export function auditLedger({ ledger, testFiles, liveTitles, run }: LedgerInputs): string[] {
  const findings: string[] = []
  let columns: number | null = null
  ledger.split('\n').forEach((line, index) => {
    const at = `org-parity.md:${index + 1}`
    if (!line.startsWith('|')) {
      columns = null
      return
    }
    const row = cells(line)
    if (columns === null) {
      columns = row.length
      if (!HEADERS.has(row.join('|'))) findings.push(`${at}: unknown table header`)
      return
    }
    if (row.every((cell) => /^-+$/.test(cell))) return
    if (row.length !== columns) {
      findings.push(`${at}: expected ${columns} cells, found ${row.length}`)
      return
    }
    const [capability = '', , status = '', proof = ''] = row.slice(-4)
    if (!STATUSES.has(status)) findings.push(`${at}: unknown status "${status}"`)
    if (!capability) findings.push(`${at}: empty capability`)
    if (!proof) findings.push(`${at}: "${capability}" gives no proof or reason`)

    const files = [...proof.matchAll(FILE_PROOF)].map(([file]) => file)
    for (const file of files) {
      if (!testFiles.has(path.basename(file))) {
        findings.push(`${at}: "${capability}" names ${file}, which does not exist`)
      }
    }
    if (!status.startsWith('Done')) return

    const quoted = [...proof.matchAll(TITLE_PROOF)].map((match) => match[1] as string)
    if (quoted.length === 0 && files.every(isLiveSpec)) {
      findings.push(
        `${at}: "${capability}" is Done with no test named. Quote a live test's title, name a test file, or mark it Unverified`
      )
    }
    for (const title of quoted) {
      if (matchingTitles(title, liveTitles).length === 0) {
        findings.push(`${at}: "${capability}" quotes a test that does not exist: "${title}"`)
        continue
      }
      if (!run) continue
      const outcomes = matchingTitles(title, run.keys()).map((match) => run.get(match))
      if (!outcomes.includes('passed')) {
        findings.push(
          `${at}: "${capability}" rests on "${title}", which ${outcomes[0] ?? 'did not run'} in this run`
        )
      }
    }
  })
  return findings
}

interface ReportSuite {
  suites?: ReportSuite[]
  specs?: { title: string; ok: boolean; tests: { results: { status: string }[] }[] }[]
}

function readRunOutcome(reports: readonly string[]): RunOutcome {
  const titles = new Map<string, string>()
  const visit = (suite: ReportSuite) => {
    suite.suites?.forEach(visit)
    for (const spec of suite.specs ?? []) {
      const statuses = spec.tests.flatMap((test) => test.results.map((result) => result.status))
      const status = statuses.includes('skipped')
        ? 'skipped'
        : spec.ok && statuses.length > 0
          ? 'passed'
          : 'failed'
      if (titles.get(spec.title) !== 'passed') titles.set(spec.title, status)
    }
  }
  for (const report of reports) {
    const parsed = JSON.parse(readFileSync(report, 'utf8')) as ReportSuite
    visit(parsed)
  }
  return titles
}

function main() {
  const app = path.resolve(import.meta.dir, '..', 'apps/sim')
  const testFiles = new Set<string>()
  const liveTitles: string[] = []
  const entries = readdirSync(app, { recursive: true, encoding: 'utf8' })
  for (const entry of entries) {
    if (entry.includes('node_modules') || entry.includes('.next')) continue
    if (!/\.(?:integration\.ts|test\.tsx?|spec\.ts)$/.test(entry)) continue
    testFiles.add(path.basename(entry))
    if (!entry.startsWith('platform/checks/live/')) continue
    const source = readFileSync(path.join(app, entry), 'utf8')
    for (const [, title] of source.matchAll(/test\(\s*[`'"]([^`]*?)[`'"],\s*(?:async|\{)/g)) {
      liveTitles.push(title as string)
    }
  }
  const { values } = parseArgs({ options: { report: { type: 'string', multiple: true } } })
  const findings = auditLedger({
    ledger: readFileSync(path.join(app, 'platform/docs/org-parity.md'), 'utf8'),
    testFiles,
    liveTitles,
    run: values.report ? readRunOutcome(values.report) : undefined,
  })
  if (findings.length > 0) {
    console.error(`check:platform-parity: ${findings.length} finding(s)\n`)
    for (const finding of findings) console.error(`  ${finding}`)
    process.exit(1)
  }
  console.log(`check:platform-parity: ledger OK against ${liveTitles.length} live tests`)
}

if (import.meta.main) main()
