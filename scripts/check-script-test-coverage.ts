#!/usr/bin/env bun
/**
 * Asserts every `scripts/*.test.ts` file is collected by the root Vitest config.
 *
 * The root `test` script once chained a hand-maintained list of `test:*` entries, and a
 * hand-maintained list silently drifts from the files on disk: a test added without a matching
 * entry never runs, in CI or locally, and nothing reports it. `scripts/check-migrations-safety.test.ts`
 * sat unreferenced and green for exactly that reason. The root `vitest.scripts.config.ts` now collects
 * the directory by glob, so drift can only come from a file the glob does not match (a test in a
 * subdirectory, a different suffix) or from the `test` script no longer chaining `test:scripts`.
 * This guard checks both by asking Vitest which files it would run.
 *
 * `run-audits.ts` derives its own list from the `check:*` namespace precisely so a new audit is
 * picked up by default, so this guard registers itself simply by being named `check:*` — it cannot
 * drift out of the runner it belongs to.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const SUB_SCRIPT_PATTERN = /bun run ([\w:-]+)/g

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

const listed = Bun.spawnSync(
  ['bunx', 'vitest', 'list', '--json', '--config', 'vitest.scripts.config.ts'],
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
    path.relative(ROOT, entry.file)
  )
)

const onDisk = readdirSync(path.join(ROOT, 'scripts'))
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => `scripts/${file}`)
  .sort()

const orphaned = onDisk.filter((file) => !collected.has(file))
if (orphaned.length > 0) {
  console.error(
    `Script tests never run by \`bun run test\`:\n${orphaned.map((file) => `  - ${file}`).join('\n')}\n` +
      'Make sure the root `vitest.scripts.config.ts` include glob matches them.'
  )
  process.exit(1)
}

console.log(
  `Script test coverage passed: ${onDisk.length} script tests collected by the root Vitest config.`
)
