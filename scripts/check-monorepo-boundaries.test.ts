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

  it('keeps @sim/workflow-code free of Node built-ins and dynamic code execution', () => {
    const fixture = mkdtempSync(path.join(ROOT, 'node_modules/.boundary-audit-'))
    try {
      mkdirSync(path.join(fixture, 'scripts'))
      mkdirSync(path.join(fixture, 'apps'))
      mkdirSync(path.join(fixture, 'packages/workflow-code/src'), { recursive: true })
      mkdirSync(path.join(fixture, 'packages/other/src'), { recursive: true })
      copyFileSync(
        path.join(ROOT, 'scripts/check-monorepo-boundaries.ts'),
        path.join(fixture, 'scripts/check-monorepo-boundaries.ts')
      )
      const source = 'packages/workflow-code/src/compile.ts'
      const cases = [
        ["import vm from 'vm'", source, false],
        ["import { runInNewContext } from 'node:vm'", source, false],
        ["import { readFile } from 'node:fs/promises'", source, false],
        ["import { exec } from 'child_process'", source, false],
        ["import type { Script } from 'node:vm'", source, false],
        ["export { spawn } from 'node:child_process'", source, false],
        ["const vm = require('vm')", source, false],
        ["const parser = import('@babel/parser')", source, false],
        ['const mod = import(specifier)', source, false],
        ["const value = eval('1 + 1')", source, false],
        ["const value = globalThis.eval('1')", source, false],
        ["const value = globalThis['eval']('1')", source, false],
        ["const run = new Function('return 1')", source, false],
        ["const run = Function('return 1')", source, false],
        ["const F = globalThis['Function']", source, false],
        ["const run = (() => {}).constructor('return 1')", source, false],
        ["const F = ({})['constructor']['constructor']", source, false],
        ['const { constructor: F } = () => {}', source, false],
        ['const { constructor } = () => {}', source, false],
        ["const { 'constructor': F } = () => {}", source, false],
        ["const { ['constructor']: F } = () => {}", source, false],
        ['const g = globalThis', source, false],
        ["const run = globalThis[['ev', 'al'].join('')]", source, false],
        ['const g = Reflect.get(globalThis, name)', source, false],
        ["const value = Reflect.apply(fn, undefined, ['1'])", source, false],
        ['const load = require', source, false],
        ['const here = import.meta.url', source, false],
        ['const w = window', source, false],
        ['class Parser { constructor() {} }', source, true],
        ['const record = { constructor: 1 }', source, true],
        ['const { name: label } = record', source, true],
        ['type Host = typeof globalThis', source, true],
        ["import vm from 'vm'", 'packages/workflow-code/src/nested/deep.ts', false],
        ["import { parse } from '@babel/parser'", source, true],
        ["import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'", source, true],
        ['const record = { eval: 1, Function: 2 }', source, true],
        ['interface Hooks { eval(): void }', source, true],
        ["// import vm from 'vm'", source, true],
        ['const text = "eval(\'x\')"', source, true],
        [
          "import { readFile } from 'node:fs/promises'",
          'packages/workflow-code/src/x.test.ts',
          true,
        ],
        ["import vm from 'node:vm'", 'packages/other/src/index.ts', true],
      ] as const

      for (const [code, file, allowed] of cases) {
        rmSync(path.join(fixture, 'packages/workflow-code/src'), { recursive: true, force: true })
        rmSync(path.join(fixture, 'packages/other/src'), { recursive: true, force: true })
        mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true })
        writeFileSync(path.join(fixture, file), `${code}\n`)
        const result = spawnSync(
          'bun',
          [path.join(fixture, 'scripts/check-monorepo-boundaries.ts')],
          { cwd: fixture, encoding: 'utf8' }
        )
        expect.soft(result.status, `${file}: ${code}\n${result.stderr}`).toBe(allowed ? 0 : 1)
        if (!allowed) expect.soft(result.stderr).toContain(`${file}:1`)
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  }, 30_000)

  it('keeps application code surface-neutral while allowing shared contract vocabulary', () => {
    const fixture = mkdtempSync(path.join(ROOT, 'node_modules/.boundary-audit-'))
    try {
      mkdirSync(path.join(fixture, 'scripts'))
      mkdirSync(path.join(fixture, 'packages'))
      mkdirSync(path.join(fixture, 'apps/sim/lib/widgets/application'), { recursive: true })
      copyFileSync(
        path.join(ROOT, 'scripts/check-monorepo-boundaries.ts'),
        path.join(fixture, 'scripts/check-monorepo-boundaries.ts')
      )
      const useCase = 'apps/sim/lib/widgets/application/use-case.ts'
      const cases = [
        ["import { NextResponse } from 'next/server'", useCase, false],
        ["import type { NextRequest } from 'next/server'", useCase, false],
        ["import { GET } from '@/app/api/widgets/route'", useCase, false],
        ["import { listWidgetsContract } from '@/lib/api/contracts/widgets'", useCase, false],
        ["export { listWidgetsContract } from '@/lib/api/contracts/widgets'", useCase, false],
        ["import * as contracts from '@/lib/api/contracts/widgets'", useCase, false],
        ["import { presentWidget } from '@/lib/api/server/widget-presenters'", useCase, false],
        ["import { presentWidget } from '@/lib/api/server/widget-presenters.ts'", useCase, false],
        ["import { run } from '@/lib/mothership/tools/handlers/run-code'", useCase, false],
        ["import {} from '@/lib/mothership/tools/handlers/run-code'", useCase, false],
        ["export {} from '@/lib/api/server/widget-presenters'", useCase, false],
        ["const tool = import('@/lib/mothership/tools/server/widgets')", useCase, false],
        ["import { listWidgetsContract } from '../../api/contracts/widgets'", useCase, false],
        ["import { GET } from '../../../app/api/widgets/route'", useCase, false],
        ["import type { ListWidgetsContract } from '../../api/contracts/widgets'", useCase, true],
        ["import type { ListWidgetsContract } from '@/lib/api/contracts/widgets'", useCase, true],
        ["import { type listWidgetsContract } from '@/lib/api/contracts/widgets'", useCase, true],
        [
          "import { widgetBodySchema, MAX_WIDGETS } from '@/lib/api/contracts/widgets'",
          useCase,
          true,
        ],
        [
          "import type { ServerToolContext } from '@/lib/mothership/tools/server/base-tool'",
          useCase,
          true,
        ],
        [
          "import { NextResponse } from 'next/server'",
          'apps/sim/lib/widgets/application/use-case.test.ts',
          true,
        ],
        ["import { NextResponse } from 'next/server'", 'apps/sim/lib/widgets/routes.ts', true],
      ] as const

      for (const [source, file, allowed] of cases) {
        rmSync(path.join(fixture, 'apps/sim/lib/widgets'), { recursive: true, force: true })
        mkdirSync(path.join(fixture, 'apps/sim/lib/widgets/application'), { recursive: true })
        writeFileSync(path.join(fixture, file), `${source}\n`)
        const result = spawnSync(
          'bun',
          [path.join(fixture, 'scripts/check-monorepo-boundaries.ts')],
          { cwd: fixture, encoding: 'utf8' }
        )
        expect.soft(result.status, `${file}: ${source}\n${result.stderr}`).toBe(allowed ? 0 : 1)
        if (!allowed) expect.soft(result.stderr).toContain(`${file}:1`)
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  }, 30_000)
})
