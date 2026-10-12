#!/usr/bin/env bun
/**
 * Asserts every script test is collected by the scripts Vitest config.
 *
 * The root `test` script once chained a hand-maintained list of `test:*` entries, and a
 * hand-maintained list silently drifts from the files on disk: a test added without a matching
 * entry never runs, in CI or locally, and nothing reports it. `scripts/check-migrations-safety.test.ts`
 * sat unreferenced and green for exactly that reason. `scripts/vitest.config.ts` now collects
 * the directory by glob, so drift can only come from a file the glob does not match (a test in a
 * subdirectory, a different suffix) or from the test commands no longer running that config.
 * This guard checks the command contract and asks Vitest which files it would run.
 *
 * `run-audits.ts` derives its own list from the `check:*` namespace precisely so a new audit is
 * picked up by default, so this guard registers itself simply by being named `check:*` — it cannot
 * drift out of the runner it belongs to.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { localBin } from './local-bin'

const ROOT = path.resolve(import.meta.dir, '..')
const SUB_SCRIPT_PATTERN = /bun run ([\w:-]+)/g
const SCRIPTS_TEST_CONFIG = 'scripts/vitest.config.ts'
const SCRIPTS_TEST_COMMAND = `vitest run --config ${SCRIPTS_TEST_CONFIG}`

const manifest = await Bun.file(path.join(ROOT, 'package.json')).json()
const commands = manifest.scripts as Record<string, string>

/** Walks the `test` script and every entry it chains. */
function reachableScripts(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const name = queue.pop() as string
    if (seen.has(name)) continue
    seen.add(name)
    for (const match of (commands[name] ?? '').matchAll(SUB_SCRIPT_PATTERN)) queue.push(match[1])
  }
  return seen
}

if (!reachableScripts('test').has('test:scripts')) {
  console.error('The root `test` script no longer chains `test:scripts`, so no script test runs.')
  process.exit(1)
}

// Keep collection tied to the actual runner; filters or another config can silently skip tests.
if (commands['test:scripts']?.trim() !== SCRIPTS_TEST_COMMAND) {
  console.error(`test:scripts must run the complete scripts Vitest config: ${SCRIPTS_TEST_COMMAND}`)
  process.exit(1)
}

const listed = Bun.spawnSync(
  [localBin('vitest'), 'list', '--json', '--filesOnly', '--config', SCRIPTS_TEST_CONFIG],
  {
    cwd: ROOT,
  }
)
if (listed.exitCode !== 0) {
  console.error(`\`vitest list\` failed:\n${listed.stderr.toString()}`)
  process.exit(1)
}
const collected = new Set(
  (JSON.parse(listed.stdout.toString()) as Array<{ file: string }>).map((entry) =>
    path.relative(ROOT, entry.file).split(path.sep).join('/')
  )
)

/** Inventory independently of the include globs so a narrowed config cannot hide its omissions. */
function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '.git', 'dist'].includes(entry.name)) return []
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return testFiles(file)
    return /\.(test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)
      ? [path.relative(ROOT, file).split(path.sep).join('/')]
      : []
  })
}
const onDisk = testFiles(path.join(ROOT, 'scripts')).sort()

const orphaned = onDisk.filter((file) => !collected.has(file))
if (orphaned.length > 0) {
  console.error(
    `Script tests never run by \`bun run test\`:\n${orphaned.map((file) => `  - ${file}`).join('\n')}\n` +
      'Make sure the scripts Vitest config collects them.'
  )
  process.exit(1)
}

console.log(
  `Script test coverage passed: ${onDisk.length} script tests collected by the scripts Vitest config.`
)
