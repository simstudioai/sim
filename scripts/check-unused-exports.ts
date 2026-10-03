#!/usr/bin/env bun
/**
 * Runs knip once for the whole dead-code audit: zero tolerance for unreachable files and
 * dependency drift, and a shrink-only ratchet for unused exports.
 *
 * `knip.jsonc` scopes plain `knip` (`check:dead-code`) to files, dependencies, unlisted, and
 * unresolved, because thousands of pre-existing unused exports would otherwise drown the report.
 * That left exports unguarded: an agent could export a helper nothing imports, or keep a dead
 * export alive after deleting its last caller, and nothing objected. This script adds knip's
 * `exports`, `types`, and `duplicates` issues on top of the same pass:
 *
 * - Every other issue knip reports must be empty: `files`, `unlisted`, `unresolved`, and every
 *   dependency type the `dependencies` include expands to (`devDependencies`,
 *   `optionalPeerDependencies`, …). Unknown keys count too, so a new knip issue type fails closed.
 * - Each unused export is normalized to a sorted `path#symbol` entry and compared with
 *   `scripts/check-unused-exports.baseline.json`. A new entry fails; so does a baseline entry that
 *   no longer occurs, so the baseline only shrinks. Regenerate with `--update`.
 *
 * Entry exports are reported (`includeEntryExports: true` in knip.jsonc): a private package's
 * `exports` map serves only this monorepo, so an entry export nothing imports is dead. The apps,
 * the published packages, db, and the root turn it off there, since their entries are public or
 * standalone. Exports used only by tests count as used because knip's Vitest plugin makes test
 * files entries. An export whose only consumer knip cannot see (a path-based `import()`, or a
 * helper an audit names as the replacement) carries a `@public` TSDoc tag saying why.
 *
 * Knip is slow, so `run-audits.ts` runs this script and skips `check:dead-code`, which stays
 * available as the human-readable report.
 *
 * Run: `bun run check:unused-exports`
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { localBin } from './local-bin'

const ROOT = path.resolve(import.meta.dir, '..')
const BASELINE = path.join(ROOT, 'scripts/check-unused-exports.baseline.json')

/** Issue types requested from knip beyond the ratchet; knip expands `dependencies` itself. */
const STRICT_TYPES = ['files', 'dependencies', 'unlisted', 'unresolved'] as const
/** Issue types ratcheted against the baseline. */
const RATCHET_TYPES = ['exports', 'types', 'duplicates'] as const

type RatchetType = (typeof RATCHET_TYPES)[number]

/** Row keys that are not issues. Everything else that is not ratcheted is gated at zero. */
const NOT_STRICT = new Set<string>(['file', 'owners', ...RATCHET_TYPES])

interface KnipSymbol {
  name: string
  line?: number
}

type KnipIssue = { file: string } & Record<string, unknown>

const HOW_TO_FIX: Record<RatchetType, string> = {
  exports:
    'Delete the export if nothing uses it, or drop the `export` keyword if it is only used in its own file.',
  types:
    'Delete the type if nothing uses it, or drop the `export` keyword if it is only used in its own file.',
  duplicates: 'The same value is exported under two names; keep one and update importers.',
}

function runKnip(): KnipIssue[] {
  const result = Bun.spawnSync(
    [
      localBin('knip'),
      '--include',
      [...STRICT_TYPES, ...RATCHET_TYPES].join(','),
      '--reporter',
      'json',
      '--no-config-hints',
    ],
    { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' }
  )
  const stdout = result.stdout.toString()
  // knip exits 1 whenever it reports an issue; only a missing JSON body is a crash.
  if (!stdout.trimStart().startsWith('{')) {
    console.error(`knip failed (exit ${result.exitCode}):\n${result.stderr.toString()}${stdout}`)
    process.exit(1)
  }
  return (JSON.parse(stdout) as { issues: KnipIssue[] }).issues
}

const issues = runKnip()
const strict: string[] = []
const kindByEntry = new Map<string, RatchetType>()
const lineByEntry = new Map<string, number>()

for (const issue of issues) {
  // Fail closed: an issue type knip adds later is gated too, never silently dropped.
  for (const [type, items] of Object.entries(issue)) {
    if (NOT_STRICT.has(type)) continue
    for (const item of (items as Array<KnipSymbol | KnipSymbol[]>) ?? []) {
      const name = Array.isArray(item) ? item.map((symbol) => symbol.name).join(' → ') : item.name
      strict.push(type === 'files' ? `files: ${issue.file}` : `${type}: ${issue.file} ${name}`)
    }
  }
  for (const type of RATCHET_TYPES) {
    const items = (issue[type] as Array<KnipSymbol | KnipSymbol[]> | undefined) ?? []
    for (const item of items) {
      const symbols = Array.isArray(item) ? item : [item]
      const name = symbols
        .map((symbol) => symbol.name)
        .sort()
        .join('=')
      const entry = `${issue.file}#${name}`
      kindByEntry.set(entry, type)
      if (symbols[0]?.line) lineByEntry.set(entry, symbols[0].line)
    }
  }
}

if (strict.length) {
  console.error(`✗ knip found ${strict.length} unreachable file(s) or dependency issue(s):`)
  for (const line of strict.sort()) console.error(`  ${line}`)
  console.error(
    '\nDelete unreachable files, declare or remove dependencies, and fix unresolved imports. ' +
      'If knip cannot see a real entry point, add it to knip.jsonc with a comment saying why. ' +
      'Details: bun run check:dead-code'
  )
}

const current = [...kindByEntry.keys()].sort()

/**
 * The committed baseline. A missing file fails closed: restore it from git. `--update --init`
 * is the only way to create one, and it accepts every current violation.
 */
function readBaseline(current: string[]): string[] {
  if (existsSync(BASELINE)) return JSON.parse(readFileSync(BASELINE, 'utf8'))
  if (process.argv.includes('--update') && process.argv.includes('--init')) return current
  console.error(
    `✗ ${path.relative(ROOT, BASELINE)} is missing. Restore it from git; ` +
      'create a new one only with --update --init.'
  )
  process.exit(1)
}

const baseline = new Set<string>(readBaseline(current))
const added = current.filter((entry) => !baseline.has(entry))

if (process.argv.includes('--update')) {
  // Shrink-only: drop fixed entries, never admit a new one, and write nothing if refusing.
  const kept = current.filter((entry) => baseline.has(entry))
  if (added.length) {
    console.error(`✗ refused to baseline ${added.length} new unused export(s); fix them instead:`)
    for (const entry of added) console.error(`  ${entry}`)
    process.exit(1)
  }
  writeFileSync(BASELINE, `${JSON.stringify(kept, null, 2)}\n`)
  console.log(`Wrote ${kept.length} baseline entries to ${path.relative(ROOT, BASELINE)}`)
  process.exit(strict.length ? 1 : 0)
}

const currentSet = new Set(current)
const stale = [...baseline].filter((entry) => !currentSet.has(entry))

if (added.length) {
  const kinds = new Set<RatchetType>()
  console.error(`\n✗ ${added.length} new unused export(s):`)
  for (const entry of added) {
    const kind = kindByEntry.get(entry) as RatchetType
    kinds.add(kind)
    const [file, symbol] = entry.split('#')
    const line = lineByEntry.get(entry)
    console.error(`  ${kind}: ${file}${line ? `:${line}` : ''} ${symbol}`)
  }
  for (const kind of kinds) console.error(`  ${kind}: ${HOW_TO_FIX[kind]}`)
  console.error(
    '  If it is deliberate public API of a published package, expose it through that package.json ' +
      '`exports` map (or add an `ignore` rule in knip.jsonc with a comment saying why). A private ' +
      "package's entry exports are checked too: delete them once nothing imports them. Never add " +
      'it to the baseline.'
  )
}

if (stale.length) {
  console.error(
    `\n✗ ${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} no longer unused ` +
      '— shrink the baseline: bun run scripts/check-unused-exports.ts --update'
  )
  for (const entry of stale.slice(0, 20)) console.error(`  ${entry}`)
  if (stale.length > 20) console.error(`  … and ${stale.length - 20} more`)
}

const staleBySymbol = new Map(
  stale.map((entry) => entry.split('#')).map(([file, symbol]) => [symbol, file])
)
const renames = new Set<string>()
for (const [file, symbol] of added.map((entry) => entry.split('#'))) {
  const old = staleBySymbol.get(symbol)
  if (old && old !== file) renames.add(`${old} → ${file}`)
}
for (const rename of renames) {
  console.error(
    `\nLooks like a rename: ${rename}. Move its baseline entries to the new path in ` +
      `${path.relative(ROOT, BASELINE)} (debt carries over; it may not grow).`
  )
}

if (strict.length || added.length || stale.length) process.exit(1)

console.log(`✓ dead code: no unreachable files; ${current.length} baselined unused exports`)
