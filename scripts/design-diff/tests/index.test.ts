import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'

it.each([
  'parity',
  'processes',
  'corruption',
  'concurrent',
  'resolution',
  'configuration',
  'snapshots',
  'themes',
  'sentinels',
  'restart',
  'missing-source',
])(
  'maintains indexed correctness: %s',
  (mode) => {
    execFileSync(
      'bun',
      ['--no-env-file', fileURLToPath(new URL('./index-runtime.ts', import.meta.url)), mode],
      { stdio: 'pipe' }
    )
  },
  30000
)
