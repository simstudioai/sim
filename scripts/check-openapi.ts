#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { localBin } from './local-bin'

const ROOT = path.resolve(import.meta.dir, '..')
const CHECKS = [
  [process.execPath, 'run', 'scripts/generate-openapi.ts', '--check'],
  [localBin('vitest'), 'run', '--config', 'scripts/openapi/vitest.config.ts'],
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
