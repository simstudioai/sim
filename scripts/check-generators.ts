#!/usr/bin/env bun
/**
 * Enforces the generated-artifact contract in `scripts/generators.ts`:
 *
 * - every `generate:<x>` has a `check:<x>`, so CI fails when its artifact drifts;
 * - every `check:<x>` that runs a generator in check mode has a `generate:<x>`, so
 *   `bun run generate` regenerates it;
 * - no test rewrites a committed artifact behind an `UPDATE_*` environment flag, where nobody
 *   runs it and the drift only surfaces in a test shard after merge.
 *
 * Run: `bun run check:generators`
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { findPairingViolations, findRegeneratingTests } from './generators'

const ROOT = path.resolve(import.meta.dir, '..')

function trackedTestFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', '*.test.ts', '*.test.tsx'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
}

function main(): void {
  const { scripts } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  const tests = trackedTestFiles().map((file) => ({
    path: file,
    content: readFileSync(path.join(ROOT, file), 'utf8'),
  }))
  const violations = [...findPairingViolations(scripts), ...findRegeneratingTests(tests)]

  if (violations.length > 0) {
    console.error(`✗ generated-artifact contract:\n- ${violations.join('\n- ')}`)
    process.exit(1)
  }
  console.log('✓ every generated artifact has a generate/check pair')
}

if (import.meta.main) main()
