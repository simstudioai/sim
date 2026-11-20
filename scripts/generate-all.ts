#!/usr/bin/env bun
/**
 * Brings every committed generated artifact back in sync with one command: `bun run generate`.
 *
 * It runs the generators `scripts/generators.ts` derives from package.json, so a new
 * `generate:<x>` / `check:<x>` pair is picked up with no list to edit here; `check:generators`
 * fails CI when a pair is incomplete.
 *
 * Generators run one at a time, in package.json order, because some read what an earlier one
 * wrote: `generate:cli-docs` reads the operation table `generate:cli-api` emits,
 * `generate:deployment-config` imports the integration metadata `generate:docs` writes,
 * `generate:docs-manifest` lists the pages `generate:cli-docs` and `generate:docs` write, and
 * `generate:sdk-fixture-catalog` projects through `generate:tool-metadata` and `generate:sdk-names`
 * output. Keep a new pair below the generators it reads.
 *
 * Not run: the `<x>:generate` / `<x>:check` suffix pairs, which need the sibling copilot repo, a
 * Helm render, or a per-machine renderer (see `run-audits.ts`), and workspace-local scripts such
 * as `apps/sim`'s `generate:pi-model-catalog`, which reads an installed package.
 *
 * Exits non-zero when any generator fails; the rest still run so one failure does not hide another.
 */
import path from 'node:path'
import { listGenerators } from './generators'

const ROOT = path.resolve(import.meta.dir, '..')

interface GeneratorResult {
  script: string
  ok: boolean
  durationMs: number
}

/**
 * Runs one generator with inherited output.
 *
 * Spawns the script directly rather than `bun run <name>`, which would start a bun process only
 * to have it read package.json and start a second one.
 */
async function runGenerator(script: string, command: string): Promise<GeneratorResult> {
  const startedAt = performance.now()
  const argv = command.replace(/^bun run /, '').split(/\s+/)
  const proc = Bun.spawn([process.execPath, ...argv], {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited
  return { script, ok: exitCode === 0, durationMs: performance.now() - startedAt }
}

const manifest = await Bun.file(path.join(ROOT, 'package.json')).json()
const commands = manifest.scripts as Record<string, string>
const generators = listGenerators(commands)
const results: GeneratorResult[] = []

for (const script of generators) {
  console.log(`\n▶ ${script}`)
  results.push(await runGenerator(script, commands[script]))
}

console.log(`\n${results.length} generators:`)
for (const result of results) {
  console.log(`${result.ok ? '✓' : '✗'} ${result.script} (${Math.round(result.durationMs)}ms)`)
}

const failures = results.filter((result) => !result.ok)
if (failures.length > 0) {
  console.error(
    `\n${failures.length} generator(s) failed: ${failures.map((f) => f.script).join(', ')}. Their output is above; fix the cause and rerun \`bun run generate\`.`
  )
  process.exit(1)
}
