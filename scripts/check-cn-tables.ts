#!/usr/bin/env bun
/**
 * Fails when `packages/emcn/src/lib/cn-tables.ts` no longer matches what
 * `cn build` produces from `packages/emcn/cn.config.mjs`.
 *
 * The tables are the `cn` merger's compiled class-group lookup, generated ahead
 * of time so the runtime config compiler stays out of the browser bundle.
 * Nothing at build or test time would notice them going stale — the merger
 * would simply resolve conflicts against an older class-group set — so the
 * drift has to be checked explicitly.
 */
import { rm } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const EMCN = path.join(ROOT, 'packages/emcn')
const COMMITTED = path.join(EMCN, 'src/lib/cn-tables.ts')
const SCRATCH_DIR = path.join(EMCN, '.cn-check')
// Same basename as the committed file: `cn build` writes the output path into
// the generated header, so a different name would always report a difference.
const SCRATCH = path.join(SCRATCH_DIR, 'cn-tables.ts')

await rm(SCRATCH_DIR, { recursive: true, force: true })

const build = Bun.spawnSync(
  ['bun', 'x', 'cn', 'build', '--full', '--config', 'cn.config.mjs', '-o', SCRATCH, '-q'],
  { cwd: EMCN, stdout: 'pipe', stderr: 'pipe' }
)

if (build.exitCode !== 0) {
  console.error('cn build failed:\n', build.stderr.toString() || build.stdout.toString())
  process.exit(1)
}

const [committed, regenerated] = await Promise.all([
  Bun.file(COMMITTED).text(),
  Bun.file(SCRATCH).text(),
])
await rm(SCRATCH_DIR, { recursive: true, force: true })

if (committed !== regenerated) {
  console.error(
    'packages/emcn/src/lib/cn-tables.ts is stale.\n' +
      'Regenerate it with:  bun --filter @sim/emcn cn:build'
  )
  process.exit(1)
}

console.log('cn tables match cn.config.mjs')
