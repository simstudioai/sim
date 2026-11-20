#!/usr/bin/env bun
/**
 * Runs every self-contained, repo-local generator, so a contributor (or `/ship`) can bring all
 * committed artifacts back in sync with one command: `bun run generate`.
 *
 * The list is derived from package.json the way `run-audits.ts` derives its audits, so a new
 * generator is picked up by default rather than added to a list here. A generator qualifies when
 * it has a matching audit: every `generate:<x>` that has a `check:<x>`, plus the older names in
 * {@link ALIASED_PAIRS}. That pairing is the repo's convention for "this artifact is a pure
 * function of the tree" (`check:audits` runs the check), so it is also what makes a generator safe
 * to run unprompted. Name a new generator `generate:<x>` / `check:<x>` and it runs here.
 *
 * Deliberately not run: the `<x>:generate` / `<x>:check` suffix pairs (`mship*`, `trace-*`,
 * `metrics`, `vfs`, `billing-protocol`, `images`, `library:covers`), which need the sibling
 * copilot repo, a Helm render, or a per-machine renderer (see `run-audits.ts`);
 * `generate:pi-model-catalog` under `apps/sim`, which reads an installed package; and
 * `scripts/generate-docs.ts`, whose broad integration-docs rewrite has no `generate:` script.
 *
 * Generators run one at a time, in package.json order, because they are not independent: some
 * read what an earlier one wrote. `generate:cli-docs` reads the operation table
 * `generate:cli-api` emits, `generate:docs-manifest` lists the pages `generate:cli-docs` writes,
 * and `generate:sdk-fixture-catalog` projects through `generate:tool-metadata` and
 * `generate:sdk-names` output. Keep a new pair below the generators it reads.
 *
 * Exits non-zero when any generator fails; the rest still run so one failure does not hide another.
 *
 * Usage:
 *   bun run generate
 */
import path from 'node:path'

/** Generators whose audit predates the `generate:<x>` / `check:<x>` naming, keyed to that audit. */
const ALIASED_PAIRS: Record<string, string> = {
  'skills:sync': 'check:skills',
}

const ROOT = path.resolve(import.meta.dir, '..')

interface GeneratorResult {
  script: string
  ok: boolean
  durationMs: number
}

function generatorScripts(scripts: Record<string, string>): string[] {
  return Object.keys(scripts).filter((name) => {
    if (name.startsWith('generate:')) return `check:${name.slice('generate:'.length)}` in scripts
    const audit = ALIASED_PAIRS[name]
    return audit !== undefined && audit in scripts
  })
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
const generators = generatorScripts(commands)
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
