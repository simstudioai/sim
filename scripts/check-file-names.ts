#!/usr/bin/env bun
/**
 * Enforces the file-naming conventions in `CLAUDE.md` "Naming" ("files kebab-case"), so an agent
 * can predict a module's path from its role and never has to guess between `workflowList.ts`,
 * `workflow_list.ts`, and `workflow-list.ts`.
 *
 * Rules, over every JS/TS source file under `apps/`, `packages/`, root `scripts/`, and
 * `vitest.shared.ts` (tracked or untracked, never gitignored, so a file is checked before it is
 * staged). Dot-prefixed folders and files (`.well-known`, `.eslintrc.cjs`) are exempt: their names
 * are mandated by the tool that reads them.
 *
 * - `kebab-case`: every path segment below the workspace root is kebab-case. Dotted suffixes
 *   (`.test.ts`, `.server.ts`, `.d.ts`, `.config.ts`) are kebab segments too. Allowed exceptions,
 *   each forced by something outside our control:
 *     - Next.js routing segments: `[param]`, `[...slug]`, `[[...slug]]`, `(group)`, `@slot`,
 *       interception routes (`(.)x`, `(..)x`, `(..)(..)x`, `(...)x`), `_private` folders, and
 *       metadata route folders named after their URL (`robots.txt`).
 *     - Vitest/fixture folders wrapped in double underscores (`__integration__`, `__fixtures__`).
 *     - The SCIM v2 resource folders (`Users`, `Groups`, …) whose casing is fixed by RFC 7644.
 *     - Integration folders (`apps/sim/{tools,triggers}/**`, `apps/sim/blocks/blocks/*`) may be
 *       snake_case: a tool file and its service folder are named after the snake_case tool or
 *       block id (`tools/google_sheets/append_row.ts`), and that id is the integration's identity.
 *     - `packages/db/script-migrations/NNNN_name.ts`, which mirror the numbered SQL migrations.
 * - `redundant-suffix`: a file inside a `utils/` or `helpers/` folder must not repeat the folder's
 *   role in its own name (`utils/date-utils.ts` → `utils/date.ts`).
 * - `stutter`: inside `apps/sim/{lib,executor,providers,stores,hooks,serializer}` and
 *   `packages/<name>/src`, a file must not start with its parent folder's name (singular or plural)
 *   followed by `-`: the folder already says it (`lib/logs/log-views.ts` → `lib/logs/views.ts`,
 *   `executor/handlers/agent/agent-handler.ts` → `agent/handler.ts`). The documented component
 *   convention `feature/feature.tsx` is an exact match, not a prefix, so it is unaffected.
 *
 * Existing violations are recorded in `scripts/check-file-names.baseline.json`. A new violation
 * fails; so does a baseline entry that no longer occurs, so the baseline only ever shrinks.
 * Regenerate it after renaming files with `bun run scripts/check-file-names.ts --update`.
 *
 * Run: `bun run check:file-names`
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const BASELINE = path.join(ROOT, 'scripts/check-file-names.baseline.json')

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const KEBAB_OR_SNAKE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/
const NEXT_DYNAMIC = /^(?:\[(?:\.\.\.)?[A-Za-z][A-Za-z0-9]*\]|\[\[\.\.\.[A-Za-z][A-Za-z0-9]*\]\])$/
const NEXT_GROUP = /^\([a-z0-9]+(?:-[a-z0-9]+)*\)$/
const NEXT_INTERCEPT = /^(?:\(\.{1,3}\)|(?:\(\.\.\))+)[a-z0-9]+(?:-[a-z0-9]+)*$/
const NEXT_SLOT = /^@[a-z0-9]+(?:-[a-z0-9]+)*$/
const NEXT_PRIVATE = /^_[a-z0-9]+(?:-[a-z0-9]+)*$/
const DUNDER = /^__[a-z0-9]+(?:-[a-z0-9]+)*__$/
const METADATA_ROUTE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:txt|xml|json|mdx|yml)$/
const SCRIPT_MIGRATION = /^packages\/db\/script-migrations\/\d{4}_[a-z0-9_]+(?:\.[a-z]+)*\.ts$/
const SCIM_PREFIX = 'apps/sim/app/api/scim/v2/'
const SCIM_RESOURCES = new Set([
  'Users',
  'Groups',
  'Schemas',
  'ResourceTypes',
  'ServiceProviderConfig',
])
const INTEGRATION_PREFIXES = ['apps/sim/tools/', 'apps/sim/triggers/', 'apps/sim/blocks/blocks/']
const ROLE_FOLDERS: Record<string, string[]> = {
  utils: ['-utils', '-util'],
  helpers: ['-helpers', '-helper'],
}
const STUTTER_ROOTS = [
  /^apps\/sim\/(?:lib|executor|providers|stores|hooks|serializer)\//,
  /^packages\/[^/]+\/src\//,
]

type Rule = 'kebab-case' | 'redundant-suffix' | 'stutter'

interface Violation {
  rule: Rule
  file: string
  /** The name the file should have, shown to the agent. */
  expected: string
}

/** Tracked and untracked-but-not-ignored source files, so new files are checked before staging. */
function sourceFiles(): string[] {
  const output = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      'apps',
      'packages',
      'scripts',
      'vitest.shared.ts',
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  // existsSync drops the old path of an unstaged `mv`, which `--cached` still lists.
  return [...new Set(output.split('\0'))]
    .filter((file) => SOURCE_FILE.test(file) && !path.basename(file).startsWith('.'))
    .filter((file) => existsSync(path.join(ROOT, file)))
    .sort()
}

function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/^-+/, '')
    .toLowerCase()
}

function isAllowedFolder(segment: string, file: string, inIntegration: boolean): boolean {
  if (KEBAB.test(segment)) return true
  if (inIntegration && KEBAB_OR_SNAKE.test(segment)) return true
  if (
    NEXT_DYNAMIC.test(segment) ||
    NEXT_GROUP.test(segment) ||
    NEXT_INTERCEPT.test(segment) ||
    NEXT_SLOT.test(segment) ||
    NEXT_PRIVATE.test(segment) ||
    DUNDER.test(segment) ||
    segment.startsWith('.')
  ) {
    return true
  }
  if (file.includes('/app/') && METADATA_ROUTE.test(segment)) return true
  return file.startsWith(SCIM_PREFIX) && SCIM_RESOURCES.has(segment)
}

function isAllowedFileName(name: string, inIntegration: boolean): boolean {
  const pattern = inIntegration ? KEBAB_OR_SNAKE : KEBAB
  return name.split('.').every((part) => pattern.test(part))
}

/** The parent folder name and its singular/plural spellings, longest first. */
function folderPrefixes(folder: string): string[] {
  const variants = new Set([folder])
  if (folder.endsWith('ies')) variants.add(`${folder.slice(0, -3)}y`)
  else if (folder.endsWith('ses') || folder.endsWith('xes')) variants.add(folder.slice(0, -2))
  else if (folder.endsWith('s')) variants.add(folder.slice(0, -1))
  else if (folder.endsWith('y')) variants.add(`${folder.slice(0, -1)}ies`)
  else variants.add(`${folder}s`)
  return [...variants].filter(Boolean).sort((a, b) => b.length - a.length)
}

function check(file: string): Violation[] {
  const violations: Violation[] = []
  const segments = file.split('/')
  const name = segments[segments.length - 1]
  // Root `scripts/` belongs to the root workspace; apps/<name>/ and packages/<name>/ are roots.
  const folders = segments.slice(segments[0] === 'scripts' ? 1 : 2, -1)
  const inIntegration = INTEGRATION_PREFIXES.some((prefix) => file.startsWith(prefix))

  if (!SCRIPT_MIGRATION.test(file)) {
    const badFolder = folders.find((segment) => !isAllowedFolder(segment, file, inIntegration))
    if (badFolder) {
      violations.push({ rule: 'kebab-case', file, expected: `folder ${toKebab(badFolder)}/` })
    } else if (!isAllowedFileName(name, inIntegration)) {
      const [stem, ...suffixes] = name.split('.')
      violations.push({
        rule: 'kebab-case',
        file,
        expected: [toKebab(stem), ...suffixes].join('.'),
      })
    }
  }

  const parent = segments[segments.length - 2]
  const [stem, ...suffixes] = name.split('.')
  const roleSuffixes = ROLE_FOLDERS[parent] ?? []
  if (roleSuffixes.some((suffix) => stem === suffix.slice(1))) {
    violations.push({
      rule: 'redundant-suffix',
      file,
      expected: `<what-it-does>.${suffixes.join('.')}`,
    })
  }
  for (const suffix of roleSuffixes) {
    if (stem.endsWith(suffix) && stem.length > suffix.length) {
      const expected = [stem.slice(0, -suffix.length), ...suffixes].join('.')
      violations.push({ rule: 'redundant-suffix', file, expected })
      break
    }
  }

  if (stem !== 'index' && STUTTER_ROOTS.some((root) => root.test(file))) {
    const prefix = folderPrefixes(parent).find((variant) => stem.startsWith(`${variant}-`))
    const short = prefix ? stem.slice(prefix.length + 1) : ''
    // `search/search-index.ts` cannot become `index.ts`: that name is reserved for barrels.
    if (prefix && short !== 'index') {
      violations.push({ rule: 'stutter', file, expected: [short, ...suffixes].join('.') })
    }
  }
  return violations
}

const HOW_TO_FIX: Record<Rule, string> = {
  'kebab-case':
    'Rename to kebab-case (CLAUDE.md "Naming": files are kebab-case, e.g. workflow-list.ts).',
  'redundant-suffix':
    'The utils/ or helpers/ folder already names the role; drop the suffix from the file name.',
  stutter:
    'The parent folder already names the domain; drop the repeated prefix (lib/logs/log-views.ts → lib/logs/views.ts). If the short name collides, pick a more specific one. ' +
    'Existing `handlers/<x>/<x>-handler.ts` files are baselined debt, not a convention to copy.',
}

function key(violation: Violation): string {
  return `${violation.rule}\t${violation.file}`
}

const violations = sourceFiles().flatMap(check)
const byKey = new Map(violations.map((violation) => [key(violation), violation]))
const current = [...byKey.keys()].sort()

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
  for (const entry of added) {
    const violation = byKey.get(entry) as Violation
    console.error(`✗ not baselined — rename: ${violation.file} → ${violation.expected}`)
  }
  if (added.length) process.exit(1)
  writeFileSync(BASELINE, `${JSON.stringify(kept, null, 2)}\n`)
  console.log(`Wrote ${kept.length} baseline entries to ${path.relative(ROOT, BASELINE)}`)
  process.exit(0)
}

const currentSet = new Set(current)
const stale = [...baseline].filter((entry) => !currentSet.has(entry))

if (added.length || stale.length) {
  const rules = new Set<Rule>()
  for (const entry of added) {
    const violation = byKey.get(entry) as Violation
    rules.add(violation.rule)
    console.error(`✗ ${violation.rule}: ${violation.file} → expected ${violation.expected}`)
  }
  for (const rule of rules) console.error(`  ${rule}: ${HOW_TO_FIX[rule]}`)
  if (added.length) {
    console.error(
      `\n${added.length} new file-name violation(s). Rename the file and update its importers; ` +
        'never add a new file to the baseline. A name mandated by an outside tool goes in the ' +
        'allowlist at the top of scripts/check-file-names.ts with a comment saying why.'
    )
  }
  if (stale.length) {
    for (const entry of stale) console.error(`  fixed: ${entry.replace('\t', ' ')}`)
    console.error(
      `\n${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} fixed — shrink the ` +
        'baseline: bun run scripts/check-file-names.ts --update'
    )
  }
  process.exit(1)
}

console.log(`✓ file names (${current.length} baselined exceptions)`)
