import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '..')

describe('script collection command', () => {
  it('collects nested scripts and reports an orphan when a config drops its tests', () => {
    const fixture = mkdtempSync(path.join(ROOT, 'node_modules/.script-coverage-'))
    try {
      mkdirSync(path.join(fixture, 'scripts/nested'), { recursive: true })
      mkdirSync(path.join(fixture, 'scripts/openapi'))
      mkdirSync(path.join(fixture, 'node_modules/.bin'), { recursive: true })
      symlinkSync(
        path.join(ROOT, 'node_modules/.bin/vitest'),
        path.join(fixture, 'node_modules/.bin/vitest')
      )
      for (const file of [
        'scripts/check-script-test-coverage.ts',
        'scripts/local-bin.ts',
        'scripts/vitest.config.ts',
        'vitest.shared.ts',
      ]) {
        copyFileSync(path.join(ROOT, file), path.join(fixture, file))
      }
      writeFileSync(
        path.join(fixture, 'package.json'),
        JSON.stringify({
          scripts: {
            test: 'bun run test:scripts',
            'test:scripts': 'vitest run --config scripts/vitest.config.ts',
          },
        })
      )
      for (const file of [
        'nested/check.test.ts',
        'nested/view.test.tsx',
        'nested/check.spec.ts',
        'openapi/api.test.ts',
      ]) {
        writeFileSync(path.join(fixture, 'scripts', file), '')
      }
      const run = () =>
        spawnSync('bun', [path.join(fixture, 'scripts/check-script-test-coverage.ts')], {
          cwd: fixture,
          encoding: 'utf8',
        })
      const valid = run()
      expect(valid.status, valid.stderr).toBe(0)
      expect(valid.stdout).toContain('4 script tests collected')

      const manifestPath = path.join(fixture, 'package.json')
      const originalManifest = readFileSync(manifestPath, 'utf8')
      for (const command of [
        'echo tests-disabled',
        'vitest run --config scripts/alternate.config.ts',
        'vitest run --config scripts/vitest.config.ts scripts/nested/check.test.ts',
      ]) {
        writeFileSync(
          manifestPath,
          JSON.stringify({ scripts: { test: 'bun run test:scripts', 'test:scripts': command } })
        )
        const disabled = run()
        expect.soft(disabled.status, command).toBe(1)
        expect
          .soft(disabled.stderr, command)
          .toContain('test:scripts must run the complete scripts')
      }
      writeFileSync(manifestPath, originalManifest)

      const config = path.join(fixture, 'scripts/vitest.config.ts')
      writeFileSync(
        config,
        readFileSync(config, 'utf8').replace(
          /include: \[[^\]]+\]/,
          "include: ['scripts/*.test.ts']"
        )
      )
      const missing = run()
      expect(missing.status, missing.stderr).toBe(1)
      expect(missing.stderr).toContain('scripts/nested/check.test.ts')
      expect(missing.stderr).toContain('scripts/nested/view.test.tsx')
      expect(missing.stderr).toContain('scripts/openapi/api.test.ts')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  }, 30_000)
})
