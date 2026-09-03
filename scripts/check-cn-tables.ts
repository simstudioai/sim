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
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const EMCN = path.join(ROOT, 'packages/emcn')
const COMMITTED = path.join(EMCN, 'src/lib/cn-tables.ts')

/**
 * The generator's own command, so the two cannot drift: a flag added to
 * `cn:build` is a flag this check regenerates with. Only the `-o` target is
 * swapped, and it keeps the committed file's basename because `cn build` writes
 * the output path into the generated header.
 */
const emcnPackage = await Bun.file(path.join(EMCN, 'package.json')).json()
const buildScript: string | undefined = emcnPackage.scripts?.['cn:build']
if (!buildScript) {
  console.error('packages/emcn/package.json has no `cn:build` script to check against.')
  process.exit(1)
}

const SCRATCH_DIR = await mkdtemp(path.join(os.tmpdir(), 'sim-cn-tables-'))
const SCRATCH = path.join(SCRATCH_DIR, path.basename(COMMITTED))

const argv = buildScript.split(/\s+/)
const outFlag = argv.indexOf('-o')
if (outFlag === -1 || !argv[outFlag + 1]) {
  console.error(`\`cn:build\` has no \`-o <path>\` to redirect: ${buildScript}`)
  process.exit(1)
}
argv[outFlag + 1] = SCRATCH
// the local bin, never `bun x`, which would reach for the registry if absent
argv[0] = path.join(ROOT, 'node_modules/.bin/cn')

const build = Bun.spawnSync([...argv, '-q'], { cwd: EMCN, stdout: 'pipe', stderr: 'pipe' })

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
      'Regenerate it with:  bun --filter @sim/emcn cn:build\n' +
      '\n' +
      'If regenerating does not settle this, check that the file is still listed\n' +
      'under `files.includes` exclusions in biome.json — the generator emits\n' +
      '4-space indent, so letting `bun run lint` reformat it makes this check\n' +
      'fail permanently against output nobody can reproduce.'
  )
  process.exit(1)
}

console.log('cn tables match cn.config.mjs')
