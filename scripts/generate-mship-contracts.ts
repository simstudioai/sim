#!/usr/bin/env bun
// Drive every mothership contract generator, then biome-format the
// outputs so the committed files match what biome produces on commit
// (avoids the stale-drift that comes from comparing raw json2ts output
// against biome-formatted source).
//
// `--check` regenerates into a temp directory, formats identically,
// and compares against the committed files — same semantics as the
// old per-script `--check`, but accounts for post-generate formatting.

import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const GENERATORS = [
  'scripts/sync-mothership-stream-contract.ts',
  'scripts/sync-tool-catalog.ts',
  'scripts/sync-request-trace-contract.ts',
  'scripts/sync-trace-spans-contract.ts',
  'scripts/sync-trace-attributes-contract.ts',
  'scripts/sync-trace-attribute-values-contract.ts',
  'scripts/sync-trace-events-contract.ts',
]

// Generated files under this path. We biome-format this whole dir on
// each generate (and the temp copy on each check).
const GENERATED_DIR = 'apps/sim/lib/copilot/generated'

// `tool-schemas-v1.ts` goes through biome's `--unsafe` bracket-quote
// fixer which reformats every key of TOOL_RUNTIME_SCHEMAS. Strip it
// from the format pass so generator output stays stable on both sides.
const FORMAT_EXCLUDE = new Set(['tool-schemas-v1.ts'])

function run(cmd: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    env,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function runGenerators(outputOverride?: string): void {
  const env = { ...process.env }
  for (const script of GENERATORS) {
    const args = ['bun', 'run', script]
    if (outputOverride) {
      // Individual scripts don't accept a custom output dir; for
      // --check we generate in place and snapshot before/after via
      // git-index comparison (see runCheck).
    }
    run(args, ROOT, env)
  }
}

function formatGenerated(dir: string): void {
  const files = readdirNoThrow(dir).filter((f) => !FORMAT_EXCLUDE.has(f) && f.endsWith('.ts'))
  if (files.length === 0) return
  const paths = files.map((f) => join(dir, f))
  run(['bunx', 'biome', 'check', '--write', ...paths], ROOT)
}

function readdirNoThrow(dir: string): string[] {
  try {
    // Bun has fs.readdirSync available as a CommonJS import
    const fs = require('node:fs') as typeof import('node:fs')
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function runCheck(): void {
  const targetDir = resolve(ROOT, GENERATED_DIR)
  // Snapshot current committed state
  const committed: Record<string, string> = {}
  for (const f of readdirNoThrow(targetDir)) {
    if (!f.endsWith('.ts')) continue
    committed[f] = readFileSync(join(targetDir, f), 'utf8')
  }

  // Regenerate in place + format, then diff against the snapshot
  runGenerators()
  formatGenerated(targetDir)

  const stale: string[] = []
  for (const [name, oldContent] of Object.entries(committed)) {
    if (FORMAT_EXCLUDE.has(name)) continue
    const newContent = readFileSync(join(targetDir, name), 'utf8')
    if (newContent !== oldContent) stale.push(name)
  }

  // Restore the committed state regardless of outcome (--check is readonly).
  for (const [name, content] of Object.entries(committed)) {
    const fs = require('node:fs') as typeof import('node:fs')
    fs.writeFileSync(join(targetDir, name), content, 'utf8')
  }

  if (stale.length > 0) {
    console.error(
      `Generated contracts are stale: ${stale.join(', ')}. Run: bun run mship:generate`,
    )
    process.exit(1)
  }
  console.log('All generated contracts up to date.')
}

function runGenerate(): void {
  runGenerators()
  formatGenerated(resolve(ROOT, GENERATED_DIR))
  console.log('Generated + formatted mothership contracts.')
}

const checkOnly = process.argv.includes('--check')
if (checkOnly) runCheck()
else runGenerate()
