#!/usr/bin/env bun
/**
 * Asserts that every workspace's bare `tsc` runs the native (Go) TypeScript 7 compiler.
 *
 * `@typescript/typescript6` (needed for apps/sim's runtime TypeScript API, and for the audit
 * scripts that read the stable compiler API) pulls in an alias of `typescript@6` that declares
 * its own `tsc` bin. Package managers pick bin winners by lexical sort, not dependency depth, so
 * it wins `node_modules/.bin/tsc` unless something sorts ahead — which is the only job the root
 * `@typescript/native` alias has. Nothing imports that alias, so deleting it looks free and
 * silently costs every `tsc` in the repo ~10x.
 *
 * Every workspace's `type-check` is a bare `tsc --noEmit`, which resolves through the nearest
 * `node_modules/.bin` walking up from that package. They all reach the root bin today, but a
 * workspace that installs anything shipping its own `tsc` would get a local one that shadows it —
 * invisible to a root-only assertion, and slow in exactly the same silent way. So each workspace
 * is resolved the way its own script would.
 *
 * @see https://github.com/microsoft/typescript-go/issues/4567
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Glob } from 'bun'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The `tsc` a bare invocation in `dir` would run: nearest `node_modules/.bin`, walking up. */
function resolveTsc(dir: string): string | null {
  let current = dir
  while (true) {
    const candidate = path.join(current, 'node_modules', '.bin', 'tsc')
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current || !current.startsWith(ROOT)) return null
    current = parent
  }
}

const workspaceDirs = [
  '.',
  ...[...new Glob('{apps,packages}/*/package.json').scanSync(ROOT)].map(path.dirname),
].sort()

const failures: string[] = []

for (const workspace of workspaceDirs) {
  const tsc = resolveTsc(path.join(ROOT, workspace))
  if (!tsc) {
    failures.push(`${workspace}: no \`tsc\` resolvable from this package`)
    continue
  }
  const result = spawnSync(tsc, ['--version'], { encoding: 'utf8' })
  const reported = result.stdout?.trim() ?? ''
  if (!/^Version 7\./.test(reported)) {
    const detail = reported || result.stderr?.trim() || `exit ${result.status}`
    failures.push(`${workspace}: ${path.relative(ROOT, tsc)} reports "${detail}"`)
  }
}

if (failures.length > 0) {
  console.error(
    `Native type-check audit failed — expected TypeScript 7.x everywhere:\n\n${failures
      .map((failure) => `  ${failure}`)
      .join('\n')}\n\n` +
      '  Check that `@typescript/native` is still in the root devDependencies, and that no newly\n' +
      '  added package sorts ahead of it while declaring a `tsc` bin.'
  )
  process.exit(1)
}

console.log(
  `Native type-check audit passed (bare \`tsc\` is TypeScript 7.x in ${workspaceDirs.length} workspaces).`
)
