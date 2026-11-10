#!/usr/bin/env bun
/**
 * Keeps the Platform's parity ledger honest. `apps/sim/platform/docs/org-parity.md` is what the
 * organization rollout is judged on, so a row marked Done has to point at something that exists: a
 * live spec's test by its quoted title, or an integration or unit test file. Anything built on live
 * data without such a check is `Unverified`, and says why. Each (Domain, Capability) pair appears once;
 * a table without a Domain column takes its section heading as the domain, in a namespace of its own,
 * so a section may point back at a Domain row it shares a name with.
 *
 * With `--report <playwright.json>` (repeatable) it also reads what that run did: a row whose
 * proving test failed or was skipped is not Done, whatever the ledger says. The two live jobs build
 * different apps and cannot read each other's reports, so `--job` holds each to its own rows: a row
 * saying it is proved in the `live (self-hosted)` job answers to that job's run, and every other row
 * answers to `product`'s.
 *
 * A row that is not Done is held to its quotes too, where a quote stands as a check (after `by`, or
 * before `in \`<file>\`` or a verb such as `reads` or `covers`): it names a live test or an
 * `org-redesign-e2e` check. Elsewhere a quote is product copy, and a Declined row quotes freely. A
 * Hidden row that cites `HIDDEN_SECTIONS` or `hidden` in `WORKSPACE_TABS` must be hidden by it.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import ts from '@typescript/typescript6'
import { ORGANIZATION_ROUTES } from './platform-product-routes'
import { listRepoFiles } from './repo-files'

const STATUSES = new Set([
  'Done',
  'Done, not copied',
  'Unverified',
  'Legacy',
  'Hidden',
  'Open',
  'Declined',
])
const HEADERS = new Set([
  'Domain|Capability|Legacy source|Status|Proof or reason',
  'Capability|Legacy source|Status|Proof or reason',
])
const FILE_PROOF = /[\w./-]+\.(?:integration\.ts|test\.tsx?|spec\.ts)/g
const TITLE_PROOF = /"([^"]+)"/g
/** Text before a quote, or after it, that makes the quote a check's title rather than copy. */
const PRECEDING_CHECK = /\bby\s*$/
const FOLLOWING_CHECK =
  /^\s+(?:in `|against\b|(?:covers|needs|opens|pins|proves|reaches|reads|reloads|shows)\b)/
const HOME_DASHBOARD = `${ORGANIZATION_ROUTES}home/_components/home-dashboard/home-dashboard.tsx`
const WORKSPACE_NAVIGATION = 'platform/lib/workspace-navigation.ts'
const SELF_HOSTED_JOB_PROOF = 'in the `live (self-hosted)` job'
const LIVE_JOBS = ['product', 'self-hosted'] as const
type LiveJob = (typeof LIVE_JOBS)[number]

/** Test title to its worst status in a run. */
type RunOutcome = Map<string, string>

interface LedgerInputs {
  ledger: string
  /** Every test file, by its path relative to the app. */
  testFiles: ReadonlySet<string>
  /** Titles of every test in the live specs. */
  liveTitles: readonly string[]
  /** Titles of every `check(...)` in `scripts/org-redesign-e2e`, which a row not yet Done may cite. */
  e2eTitles?: readonly string[]
  /** What the hide switches hide: `HIDDEN_SECTIONS` members, and `WORKSPACE_TABS` hidden labels. */
  hidden?: { sections: ReadonlySet<string>; tabs: ReadonlySet<string> }
  run?: RunOutcome
  /** Which job's run this is. Without it, the run answers for every row. */
  job?: LiveJob
}

function cells(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim())
}

/**
 * The live tests a quote names: the one whose title it is, or else every title containing it. A
 * quote is a proof only when this is exactly one test.
 */
function matchingTitles(quoted: string, titles: readonly string[]): string[] {
  const needle = quoted.toLowerCase()
  const exact = titles.filter((title) => title.toLowerCase() === needle)
  return exact.length ? exact : titles.filter((title) => title.toLowerCase().includes(needle))
}

/**
 * How a live test fared in a run: its worst outcome across every run title it produced, since a
 * parameterized title runs once per case.
 */
function runOutcome(title: string, run: RunOutcome): string | undefined {
  const pattern = new RegExp(
    `^${title
      .split(/\$\{[^}]*\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.+')}$`
  )
  const outcomes = [...run].filter(([name]) => pattern.test(name)).map(([, status]) => status)
  return outcomes.find((status) => status !== 'passed') ?? outcomes[0]
}

/** Whether a proof names an existing test file, by its whole path or a trailing part of it. */
function namesTestFile(proof: string, testFiles: ReadonlySet<string>): boolean {
  const suffix = proof.replace(/^(?:\.\/)?(?:apps\/sim\/)?/, '')
  return [...testFiles].some((file) => file === suffix || file.endsWith(`/${suffix}`))
}

/**
 * The title of every `test(...)` (and `test.skip`/`only`/`fixme`) a spec declares. A parameterized
 * title keeps its placeholders as written (`a saved ${from} lands on ${to}`).
 */
export function liveTestTitles(
  source: string,
  callee = /^test(?:\.(?:skip|only|fixme|fail))?$/
): string[] {
  const titles: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText()
      const [title] = node.arguments
      if (
        callee.test(name) &&
        title &&
        (ts.isStringLiteralLike(title) || ts.isTemplateExpression(title))
      )
        titles.push(ts.isTemplateExpression(title) ? title.getText().slice(1, -1) : title.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true))
  return titles
}

function isLiveSpec(file: string): boolean {
  return file.endsWith('.spec.ts') && file.includes('checks/')
}

/** The string literals `name`'s declaration holds, such as the members of `new Set([...])`. */
function declaredStrings(source: string, name: string, keep?: (node: ts.Node) => boolean) {
  const strings = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === name) {
      const collect = (child: ts.Node) => {
        if (ts.isStringLiteralLike(child) && (!keep || keep(child))) strings.add(child.text)
        ts.forEachChild(child, collect)
      }
      if (node.initializer) collect(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true))
  return strings
}

/** The label of a `WORKSPACE_TABS` entry marked `hidden: true`. */
function isHiddenTabLabel(node: ts.Node) {
  const property = node.parent
  const entry = property?.parent
  return (
    ts.isPropertyAssignment(property) &&
    property.name.getText() === 'label' &&
    ts.isObjectLiteralExpression(entry) &&
    entry.properties.some(
      (other) =>
        ts.isPropertyAssignment(other) &&
        other.name.getText() === 'hidden' &&
        other.initializer.kind === ts.SyntaxKind.TrueKeyword
    )
  )
}

/** What the hide switches hide, read from the home dashboard's and workspace navigation's source. */
export function hideSwitches(homeDashboard: string, workspaceNavigation: string) {
  return {
    sections: declaredStrings(homeDashboard, 'HIDDEN_SECTIONS'),
    tabs: declaredStrings(workspaceNavigation, 'WORKSPACE_TABS', isHiddenTabLabel),
  }
}

export function auditLedger({
  ledger,
  testFiles,
  liveTitles,
  e2eTitles = [],
  hidden,
  run,
  job,
}: LedgerInputs): string[] {
  const findings: string[] = []
  const firstRowAt = new Map<string, number>()
  let columns: number | null = null
  let heading = ''
  ledger.split('\n').forEach((line, index) => {
    const at = `org-parity.md:${index + 1}`
    if (!line.startsWith('|')) {
      columns = null
      if (line.startsWith('#')) heading = line.replace(/^#+\s*/, '').trim()
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
    const domain = columns === 5 ? (row[0] ?? '') : `the ${heading} section`
    const key = `${columns}|${domain}|${capability}`.toLowerCase()
    const firstAt = firstRowAt.get(key)
    if (firstAt === undefined) firstRowAt.set(key, index + 1)
    else findings.push(`${at}: "${capability}" in ${domain} repeats the row at line ${firstAt}`)
    if (!proof) findings.push(`${at}: "${capability}" gives no proof or reason`)

    const files = [...proof.matchAll(FILE_PROOF)].map(([file]) => file)
    for (const file of files) {
      if (!namesTestFile(file, testFiles)) {
        findings.push(`${at}: "${capability}" names ${file}, which does not exist`)
      }
    }
    if (status === 'Hidden' && hidden) {
      if (proof.includes('`HIDDEN_SECTIONS`') && !hidden.sections.has(capability))
        findings.push(
          `${at}: "${capability}" cites HIDDEN_SECTIONS, which does not hide it; hide it there or correct the row`
        )
      if (
        /`hidden` in `WORKSPACE_TABS`/.test(proof) &&
        ![...hidden.tabs].some((label) => capability.startsWith(`${label} `))
      )
        findings.push(
          `${at}: "${capability}" cites \`hidden\` in WORKSPACE_TABS, but no hidden tab is labelled so; hide it there or correct the row`
        )
    }
    if (!status.startsWith('Done')) {
      if (status === 'Declined') return
      for (const match of proof.matchAll(TITLE_PROOF)) {
        const title = match[1] as string
        const before = proof.slice(0, match.index)
        const after = proof.slice((match.index ?? 0) + match[0].length)
        if (!PRECEDING_CHECK.test(before) && !FOLLOWING_CHECK.test(after)) continue
        if (!matchingTitles(title, [...liveTitles, ...e2eTitles]).length)
          findings.push(
            `${at}: "${capability}" cites a check that does not exist: "${title}". Quote a live test's or an org-redesign-e2e check's title as it now reads`
          )
      }
      return
    }

    const answersToThisRun =
      !job || proof.includes(SELF_HOSTED_JOB_PROOF) === (job === 'self-hosted')
    const quoted = [...proof.matchAll(TITLE_PROOF)].map((match) => match[1] as string)
    if (quoted.length === 0 && files.every(isLiveSpec)) {
      findings.push(
        `${at}: "${capability}" is Done with no test named. Quote a live test's title, name a test file, or mark it Unverified`
      )
    }
    for (const title of quoted) {
      const [match, ...others] = matchingTitles(title, liveTitles)
      if (!match) {
        findings.push(`${at}: "${capability}" quotes a test that does not exist: "${title}"`)
        continue
      }
      if (others.length) {
        findings.push(
          `${at}: "${capability}" quotes "${title}", which ${others.length + 1} tests contain; quote one test's whole title`
        )
        continue
      }
      if (!run || !answersToThisRun) continue
      const outcome = runOutcome(match, run)
      if (outcome !== 'passed') {
        findings.push(
          `${at}: "${capability}" rests on "${title}", which ${outcome ?? 'did not run'} in this run`
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
    if (!existsSync(report)) {
      console.error(
        `check:platform-parity: --report ${report} does not exist; did the live run write it?`
      )
      process.exit(1)
    }
    visit(JSON.parse(readFileSync(report, 'utf8')) as ReportSuite)
  }
  return titles
}

function main() {
  const root = path.resolve(import.meta.dir, '..')
  const app = path.join(root, 'apps/sim')
  const testFiles = new Set<string>()
  const liveTitles: string[] = []
  const e2eTitles: string[] = []
  for (const file of listRepoFiles(root)) {
    if (!file.startsWith('apps/sim/')) continue
    const entry = file.slice('apps/sim/'.length)
    if (entry.startsWith('scripts/org-redesign-e2e/') && entry.endsWith('.ts'))
      e2eTitles.push(...liveTestTitles(readFileSync(path.join(app, entry), 'utf8'), /^check$/))
    if (!/\.(?:integration\.ts|test\.tsx?|spec\.ts)$/.test(entry)) continue
    testFiles.add(entry)
    if (entry.startsWith('platform/checks/live/'))
      liveTitles.push(...liveTestTitles(readFileSync(path.join(app, entry), 'utf8')))
  }
  const read = (file: string) =>
    existsSync(path.join(app, file)) ? readFileSync(path.join(app, file), 'utf8') : ''
  const { values } = parseArgs({
    options: { report: { type: 'string', multiple: true }, job: { type: 'string' } },
  })
  const job = LIVE_JOBS.find((candidate) => candidate === values.job)
  if (values.job && !job) throw new Error(`--job must be one of ${LIVE_JOBS.join(', ')}`)
  const findings = auditLedger({
    ledger: readFileSync(path.join(app, 'platform/docs/org-parity.md'), 'utf8'),
    testFiles,
    liveTitles,
    e2eTitles,
    hidden: hideSwitches(read(HOME_DASHBOARD), read(WORKSPACE_NAVIGATION)),
    run: values.report ? readRunOutcome(values.report) : undefined,
    job,
  })
  if (findings.length > 0) {
    console.error(`check:platform-parity: ${findings.length} finding(s)\n`)
    for (const finding of findings) console.error(`  ${finding}`)
    process.exit(1)
  }
  console.log(`check:platform-parity: ledger OK against ${liveTitles.length} live tests`)
}

if (import.meta.main) main()
