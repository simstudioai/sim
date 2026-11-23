#!/usr/bin/env bun
/**
 * Asserts that every golden print of `@sim/workflow-code`'s printer is a Biome fixed point.
 *
 * The printer formats workflow source itself: no formatter runs at print time, so a print
 * never depends on a formatter version and works in the browser. Its doc printer mirrors Biome's
 * layout rules; if it drifts, every printed file churns the first time a user runs `bun run lint`
 * on it. This runs `biome check --write` (format, organize imports, safe fixes) over each golden
 * under `packages/workflow-code/src/print/__golden__/` and fails on any difference.
 *
 * To fix a failure, change the doc printer (`packages/workflow-code/src/print/`) until the golden
 * it prints matches Biome's output, then refresh the goldens with
 * `bun run --cwd apps/sim test lib/workflows/code/goldens.test.ts -u`. Never edit a golden by hand.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GOLDEN_DIR = path.join(ROOT, 'packages/workflow-code/src/print/__golden__')
const BIOME = path.join(ROOT, 'node_modules/.bin/biome')

const goldens = readdirSync(GOLDEN_DIR)
  .filter((name) => name.endsWith('.txt'))
  .sort()

if (goldens.length === 0) {
  console.error(`No goldens found in ${GOLDEN_DIR}`)
  process.exit(1)
}

const failures: string[] = []
for (const name of goldens) {
  const text = readFileSync(path.join(GOLDEN_DIR, name), 'utf8')
  const result = spawnSync(
    BIOME,
    [
      'check',
      '--write',
      `--config-path=${path.join(ROOT, 'biome.json')}`,
      '--stdin-file-path=golden.ts',
    ],
    { input: text, encoding: 'utf8', cwd: ROOT }
  )
  if (result.error) {
    console.error(`Could not run Biome at ${BIOME}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0 || result.stdout !== text) {
    failures.push(`${name}${result.stderr ? `\n${result.stderr.trim()}` : ''}`)
  }
}

if (failures.length > 0) {
  console.error(`Golden prints that are not a Biome fixed point:\n${failures.join('\n')}`)
  process.exit(1)
}
console.log(`${goldens.length} workflow-code goldens are Biome fixed points`)
