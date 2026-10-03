import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '..')

describe('package boundary command', () => {
  it('rejects app module edges regardless of import form, without treating documentation as imports', () => {
    const fixture = mkdtempSync(path.join(ROOT, 'node_modules/.boundary-audit-'))
    try {
      mkdirSync(path.join(fixture, 'scripts'))
      mkdirSync(path.join(fixture, 'packages/example/src'), { recursive: true })
      mkdirSync(path.join(fixture, 'apps/web'), { recursive: true })
      mkdirSync(path.join(fixture, 'apps/docs'))
      mkdirSync(path.join(fixture, 'apps/no-package'))
      writeFileSync(
        path.join(fixture, 'apps/web/package.json'),
        JSON.stringify({ name: '@example/web' })
      )
      writeFileSync(
        path.join(fixture, 'apps/docs/package.json'),
        JSON.stringify({ name: 'example-docs' })
      )
      copyFileSync(
        path.join(ROOT, 'scripts/check-monorepo-boundaries.ts'),
        path.join(fixture, 'scripts/check-monorepo-boundaries.ts')
      )
      const cases = [
        ["import { value } from '@/lib/value'", false],
        ["import '@/lib/value'", false],
        ["export * from '../../../apps/sim/lib/value'", false],
        ["import { value } from '../../../apps/sim/lib/value'", false],
        ["const value = import('@/lib/value')", false],
        ['const value = import(`@/lib/value`)', false],
        ["const value = require('../../../apps/sim/lib/value')", false],
        ["import value = require('../../../apps/sim/lib/value')", false],
        ["type Value = import('../../../apps/sim/lib/value').Value", false],
        [String.raw`import '\x40/lib/value'`, false],
        ["import { value } from '@example/web'", false],
        ["import { value } from '@example/web/lib/value'", false],
        ["import 'example-docs'", false],
        ["import 'example-docs/lib/value'", false],
        ["import { value } from './apps/value'", true],
        ["import { value } from '@sim/utils/errors'", true],
        ["import { value } from '@example/web-utils'", true],
        ["import { value } from 'example-docs-utils'", true],
        ["// import { value } from '@/lib/value'", true],
        ['const example = "import { value } from \'@/lib/value\'"', true],
      ] as const

      for (const [source, allowed] of cases) {
        writeFileSync(path.join(fixture, 'packages/example/src/index.ts'), `${source}\n`)
        const result = spawnSync(
          'bun',
          [path.join(fixture, 'scripts/check-monorepo-boundaries.ts')],
          {
            cwd: fixture,
            encoding: 'utf8',
          }
        )
        expect.soft(result.status, `${source}\n${result.stderr}`).toBe(allowed ? 0 : 1)
        if (!allowed) expect.soft(result.stderr).toContain('packages/example/src/index.ts:1')
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  }, 30_000)
})
