#!/usr/bin/env bun
/**
 * Asserts that a bare `tsc` runs the native (Go) TypeScript 7 compiler.
 *
 * `@typescript/typescript6` (needed for apps/sim's runtime TypeScript API) pulls in an alias of
 * `typescript@6` that declares its own `tsc` bin. Package managers pick bin winners by lexical
 * sort, not dependency depth, so it wins `node_modules/.bin/tsc` unless something sorts ahead —
 * which is the only job the root `@typescript/native` alias has. Nothing imports that alias, so
 * deleting it looks free and silently costs every `tsc` in the repo ~10x.
 *
 * @see https://github.com/microsoft/typescript-go/issues/4567
 */
import { spawnSync } from 'node:child_process'
import { localBin } from './local-bin'

const result = spawnSync(localBin('tsc'), ['--version'], { encoding: 'utf8' })
const reported = result.stdout?.trim() ?? ''

if (!/^Version 7\./.test(reported)) {
  const detail = reported || result.stderr?.trim() || `exit ${result.status}`
  console.error(
    `Native type-check audit failed: node_modules/.bin/tsc reports "${detail}", expected TypeScript 7.x.\n\n` +
      '  Check that `@typescript/native` is still in the root devDependencies, and that no newly\n' +
      '  added package sorts ahead of it while declaring a `tsc` bin.'
  )
  process.exit(1)
}

console.log(`Native type-check audit passed (bare \`tsc\` is ${reported}).`)
