#!/usr/bin/env bun
/**
 * Asserts every `scripts/*.test.ts` file is reachable from the root `test` script.
 *
 * The root `test` script chains a hand-maintained list of `test:*` entries, and a hand-maintained
 * list silently drifts from the files on disk: a test added without a matching entry never runs,
 * in CI or locally, and nothing reports it. `scripts/check-migrations-safety.test.ts` sat
 * unreferenced and green for exactly that reason.
 *
 * `run-audits.ts` derives its own list from the `check:*` namespace precisely so a new audit is
 * picked up by default, so this guard registers itself simply by being named `check:*` — it cannot
 * drift out of the runner it belongs to.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const TEST_FILE_PATTERN = /scripts\/[\w.-]+\.test\.ts/g
const SUB_SCRIPT_PATTERN = /bun run ([\w:-]+)/g

const manifest = await Bun.file(path.join(ROOT, 'package.json')).json()
const commands = manifest.scripts as Record<string, string>

/** Walks the `test` script and every `test:*` entry it chains, collecting referenced test files. */
function reachableTestFiles(entry: string): Set<string> {
  const referenced = new Set<string>()
  const seen = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const name = queue.pop() as string
    if (seen.has(name)) continue
    seen.add(name)

    const command = commands[name]
    if (command === undefined) continue

    for (const match of command.matchAll(TEST_FILE_PATTERN)) referenced.add(match[0])
    for (const match of command.matchAll(SUB_SCRIPT_PATTERN)) queue.push(match[1])
  }

  return referenced
}

const onDisk = readdirSync(path.join(ROOT, 'scripts'))
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => `scripts/${file}`)
  .sort()

const reachable = reachableTestFiles('test')
const orphaned = onDisk.filter((file) => !reachable.has(file))
const missing = [...reachable].filter((file) => !onDisk.includes(file)).sort()

if (orphaned.length > 0 || missing.length > 0) {
  if (orphaned.length > 0) {
    console.error(
      `Script tests never run by \`bun run test\`:\n${orphaned.map((file) => `  - ${file}`).join('\n')}\n` +
        'Add a `test:*` entry for each and chain it into the root `test` script.'
    )
  }
  if (missing.length > 0) {
    console.error(
      `Root \`test\` script references script tests that do not exist:\n${missing.map((file) => `  - ${file}`).join('\n')}`
    )
  }
  process.exit(1)
}

console.log(
  `Script test coverage passed: ${onDisk.length} script tests reachable from \`bun run test\`.`
)
