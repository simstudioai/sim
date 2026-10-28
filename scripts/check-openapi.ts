#!/usr/bin/env bun
/**
 * Fails when the published OpenAPI specs drift from the v2 route contracts.
 *
 * Runs two checks in order and stops at the first failure:
 *
 * 1. `generate-openapi.ts --check`: every committed spec matches what the generator renders
 *    from `apps/sim/lib/api/contracts/v2/openapi/`. Fix by running `bun run generate:openapi`
 *    and committing the result.
 * 2. `check-openapi-specs.ts`: spec integrity, v2 conventions, and the contract cross-check.
 *    Its header lists each rule; fix the contract or its OpenAPI definition, then regenerate.
 *
 * Run: `bun run check:openapi`
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const CHECKS = [
  [process.execPath, 'run', 'scripts/generate-openapi.ts', '--check'],
  [process.execPath, 'run', 'scripts/check-openapi-specs.ts'],
] as const

for (const [command, ...args] of CHECKS) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
