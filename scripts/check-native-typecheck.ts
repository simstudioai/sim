#!/usr/bin/env bun
/**
 * Asserts that a bare `tsc` runs the native (Go) TypeScript 7 compiler.
 *
 * `apps/sim` needs `@typescript/typescript6` for its runtime TypeScript API, and that
 * package depends on `@typescript/old` — an alias of `typescript@6` — which declares its
 * own `tsc` bin. Package managers pick bin winners by lexical sort rather than dependency
 * depth, so `@typescript/old` beats `typescript` and `node_modules/.bin/tsc` silently
 * becomes the JavaScript TypeScript 6 compiler: identical diagnostics, ~10x slower.
 *
 * The root `@typescript/native` alias exists purely to win that sort. Nothing imports it —
 * deleting it costs every `tsc` invocation in the repo an order of magnitude, with no
 * visible failure. This audit is what makes that regression loud.
 *
 * @see https://github.com/microsoft/typescript-go/issues/4567
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const BIN_TSC = path.join(ROOT, 'node_modules', '.bin', 'tsc')

const result = spawnSync(BIN_TSC, ['--version'], { encoding: 'utf8' })
const reported = result.stdout?.trim() ?? ''

if (!/^Version 7\./.test(reported)) {
  const detail = reported || result.stderr?.trim() || `exit ${result.status}`
  console.error('Native type-check audit failed:\n')
  console.error(`  node_modules/.bin/tsc reports "${detail}", expected TypeScript 7.x (native).`)
  console.error(
    '\n  A bare `tsc` has fallen back to the JavaScript TypeScript 6 compiler that\n' +
      '  `@typescript/typescript6` pulls in transitively — same diagnostics, ~10x slower.\n' +
      '  Check that the `@typescript/native` alias is still in the root devDependencies,\n' +
      '  and that no newly added package sorts ahead of it while declaring a `tsc` bin.'
  )
  process.exit(1)
}

console.log(`Native type-check audit passed (bare \`tsc\` is ${reported}).`)
