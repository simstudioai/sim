#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const CHECKS = [
  ['run', 'scripts/generate-openapi.ts', '--check'],
  ['x', 'vitest', 'run', '--config', 'scripts/openapi/vitest.config.ts'],
  ['run', 'scripts/check-openapi-specs.ts'],
] as const

for (const args of CHECKS) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
