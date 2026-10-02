#!/usr/bin/env bun
/**
 * Ratchets explicit `any` and non-null assertions (`value!`) down, file by file.
 *
 * CLAUDE.md forbids `any` ("use precise types or `unknown` with guards"), but Biome's
 * `suspicious/noExplicitAny` and `style/noNonNullAssertion` are off repo-wide because thousands of
 * existing hits predate the rule. With the rules off nothing stops a new one, and an agent copying
 * a nearby `as any` has no signal it is wrong. This check runs exactly those two Biome rules (the
 * same parser, ignore list, and `any` forms Biome knows: `: any`, `as any`, `<any>`, `any[]`) and
 * compares per-file counts with `scripts/check-explicit-any.baseline.json`.
 *
 * - A file whose count rises, or a file that gains its first hit, fails.
 * - A file whose count drops fails until the baseline is rewritten, so the baseline only shrinks
 *   and a fix cannot be silently spent on a new `any` elsewhere in the same file.
 *
 * Regenerate after removing hits: `bun run scripts/check-explicit-any.ts --update`.
 *
 * Run: `bun run check:explicit-any`
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { localBin } from './local-bin'

const ROOT = path.resolve(import.meta.dir, '..')
const BASELINE = path.join(ROOT, 'scripts/check-explicit-any.baseline.json')

const METRICS = {
  explicitAny: 'lint/suspicious/noExplicitAny',
  nonNullAssertion: 'lint/style/noNonNullAssertion',
} as const

type Metric = keyof typeof METRICS
type Counts = Record<string, number>
type Baseline = Record<Metric, Counts>

const HOW_TO_FIX: Record<Metric, string> = {
  explicitAny:
    'Replace `any` with a precise type, or `unknown` narrowed by a guard (CLAUDE.md "TypeScript": no `any`). ' +
    'For untyped payloads use the `@sim/utils/object` and `@sim/utils/coerce` readers.',
  nonNullAssertion:
    'Replace `value!` with a real check (early return, `??` default, or a guard that throws a named error).',
}

/** Runs the two Biome rules once and counts their diagnostics per file. */
function collect(): Baseline {
  const result = Bun.spawnSync(
    [
      localBin('biome'),
      'lint',
      ...Object.values(METRICS).map((rule) => `--only=${rule.replace(/^lint\//, '')}`),
      // The JSON reporter embeds each file's full source per diagnostic (~190 MB); this is one line each.
      '--reporter=github',
      '--max-diagnostics=none',
      'apps',
      'packages',
    ],
    { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' }
  )
  // Hits are reported as diagnostics, so only a run that produced none counts as a failure.
  if (result.exitCode !== 0 && !result.stdout.toString().includes('::')) {
    console.error(`biome lint failed:\n${result.stderr.toString()}`)
    process.exit(1)
  }
  const counts: Baseline = { explicitAny: {}, nonNullAssertion: {} }
  const ruleToMetric = new Map<string, Metric>(
    Object.entries(METRICS).map(([metric, rule]) => [rule, metric as Metric])
  )
  for (const line of result.stdout.toString().split('\n')) {
    const match = /^::\w+ title=([^,]+),file=([^,]+),/.exec(line)
    const metric = match && ruleToMetric.get(match[1])
    if (!match || !metric) continue
    counts[metric][match[2]] = (counts[metric][match[2]] ?? 0) + 1
  }
  return counts
}

function sorted(counts: Counts): Counts {
  return Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((file) => [file, counts[file]])
  )
}

function total(counts: Counts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

const current = collect()
/**
 * The committed baseline. A missing file fails closed: restore it from git. `--update --init`
 * is the only way to create one, and it accepts every current hit.
 */
function readBaseline(): Baseline {
  if (existsSync(BASELINE)) return JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline
  if (process.argv.includes('--update') && process.argv.includes('--init')) return current
  console.error(
    `✗ ${path.relative(ROOT, BASELINE)} is missing. Restore it from git; ` +
      'create a new one only with --update --init.'
  )
  process.exit(1)
}

const baseline = readBaseline()

/** Per-file counts clamped to the baseline, so an update can only lower them. */
function shrunkTo(after: Counts, before: Counts): Counts {
  return Object.fromEntries(
    Object.entries(after)
      .map(([file, count]): [string, number] => [file, Math.min(count, before[file] ?? 0)])
      .filter(([, count]) => count > 0)
  )
}

if (process.argv.includes('--update')) {
  const next: Baseline = {
    explicitAny: sorted(shrunkTo(current.explicitAny, baseline.explicitAny ?? {})),
    nonNullAssertion: sorted(shrunkTo(current.nonNullAssertion, baseline.nonNullAssertion ?? {})),
  }
  const raised = (Object.keys(METRICS) as Metric[]).flatMap((metric) =>
    Object.entries(current[metric])
      .filter(([file, count]) => count > (baseline[metric]?.[file] ?? 0))
      .map(
        ([file, count]) =>
          `  ${metric} ${file}: ${count} (baseline ${baseline[metric]?.[file] ?? 0})`
      )
  )
  if (raised.length) {
    console.error(`✗ refused to raise the baseline for ${raised.length} file(s); fix them instead:`)
    console.error(raised.sort().join('\n'))
    process.exit(1)
  }
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
  console.log(
    `Wrote ${path.relative(ROOT, BASELINE)}: ${total(next.explicitAny)} explicit any, ` +
      `${total(next.nonNullAssertion)} non-null assertions`
  )
  process.exit(0)
}

let regressed = 0
let stale = 0

for (const metric of Object.keys(METRICS) as Metric[]) {
  const before = baseline[metric] ?? {}
  const after = current[metric]
  const regressions: string[] = []
  for (const [file, count] of Object.entries(after)) {
    const allowed = before[file] ?? 0
    if (count > allowed) regressions.push(`  ${file}: ${count} (baseline ${allowed})`)
  }
  const shrunk = Object.entries(before)
    .filter(([file, count]) => (after[file] ?? 0) < count)
    .map(([file, count]) => `  ${file}: ${after[file] ?? 0} (baseline ${count})`)
  if (regressions.length) {
    console.error(`✗ ${metric}: ${regressions.length} file(s) gained ${METRICS[metric]} hits`)
    console.error(regressions.sort().join('\n'))
    console.error(`  ${HOW_TO_FIX[metric]}`)
    console.error(
      `  List them: bunx biome lint --only=${METRICS[metric].replace(/^lint\//, '')} <file>\n`
    )
  }
  if (shrunk.length) {
    console.error(`✗ ${metric}: ${shrunk.length} file(s) dropped below the baseline`)
    console.error(shrunk.sort().join('\n'))
  }
  regressed += regressions.length
  stale += shrunk.length
}

if (regressed || stale) {
  if (stale) {
    console.error(
      '\nCounts dropped — shrink the baseline so they cannot creep back: ' +
        'bun run scripts/check-explicit-any.ts --update'
    )
  }
  if (regressed) console.error('\nNever raise the baseline to make a new `any` or `!` pass.')
  process.exit(1)
}

console.log(
  `✓ explicit any (${total(current.explicitAny)} baselined) and non-null assertions ` +
    `(${total(current.nonNullAssertion)} baselined)`
)
