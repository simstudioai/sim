import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  describe('organization surface seam', () => {
    const LIB_FILE = 'apps/sim/platform/lib/data/widget.ts'
    const VIEW_FILE = 'apps/sim/platform/app/(shell)/widget/widget.tsx'

    function withFixture(
      run: (fixture: string, audit: (...args: string[]) => ReturnType<typeof spawnSync>) => void
    ) {
      const fixture = mkdtempSync(path.join(ROOT, 'node_modules/.boundary-audit-'))
      try {
        mkdirSync(path.join(fixture, 'scripts'))
        mkdirSync(path.join(fixture, 'packages'))
        mkdirSync(path.join(fixture, 'apps/sim/platform/lib/data'), { recursive: true })
        mkdirSync(path.join(fixture, 'apps/sim/platform/app/(shell)/widget'), { recursive: true })
        copyFileSync(
          path.join(ROOT, 'scripts/check-monorepo-boundaries.ts'),
          path.join(fixture, 'scripts/check-monorepo-boundaries.ts')
        )
        run(fixture, (...args) =>
          spawnSync('bun', [path.join(fixture, 'scripts/check-monorepo-boundaries.ts'), ...args], {
            cwd: fixture,
            encoding: 'utf8',
          })
        )
      } finally {
        rmSync(fixture, { recursive: true, force: true })
      }
    }

    it('keeps platform/lib from importing a view, even for a type', () => {
      withFixture((fixture, audit) => {
        const cases = [
          ["import { Row } from '@/platform/app/(shell)/row'", false],
          ["import type { Row } from '@/platform/app/(shell)/model'", false],
          ["export { Row } from '../../app/(shell)/row'", false],
          ["const row = import('@/platform/app/(shell)/row')", false],
          ["import { value } from '@/platform/lib/data/value'", true],
        ] as const
        for (const [source, allowed] of cases) {
          writeFileSync(path.join(fixture, LIB_FILE), `${source}\n`)
          const result = audit()
          expect.soft(result.status, `${source}\n${result.stderr}`).toBe(allowed ? 0 : 1)
          if (!allowed) expect.soft(result.stderr).toContain(`${LIB_FILE}:1`)
        }
      })
    })

    it('keeps a view from reading data around platform/lib/data', () => {
      withFixture((fixture, audit) => {
        const cases = [
          ["import { useWidgets } from '@/hooks/queries/widgets'", false],
          ["import { useWidgets } from '@/ee/widgets/hooks/widgets'", false],
          ["export { useWidgets } from '@/ee/widgets/hooks/widgets'", false],
          ["import { useDeep } from '@/ee/widgets/parts/hooks/deep'", false],
          ["import { useFlat } from '@/ee/hooks'", false],
          ["const widgets = import('@/hooks/queries/widgets')", false],
          ["import { useWidgets } from '../../../../hooks/queries/widgets'", false],
          ["import type { Widget } from '@/hooks/queries/widgets'", true],
          ["import { useWidgets } from '@/platform/lib/data/widgets'", true],
          ["import { useDebounce } from '@/hooks/use-debounce'", true],
          ["import { WIDGET_LABELS } from '@/ee/widgets/labels'", true],
          ["import { widgetSummary } from '@/ee/widgets/lib/summary'", true],
          ["import { WIDGET_LIMIT } from '@/ee/widgets/constants'", true],
          ["import { hooksDoc } from '@/ee/hooks-docs/lib'", true],
        ] as const
        for (const [source, allowed] of cases) {
          writeFileSync(path.join(fixture, VIEW_FILE), `${source}\n`)
          const result = audit()
          expect.soft(result.status, `${source}\n${result.stderr}`).toBe(allowed ? 0 : 1)
          if (!allowed) expect.soft(result.stderr).toContain(`${VIEW_FILE}:1`)
        }
      })
    })

    it('ratchets view edges: a new one fails, and the baseline only shrinks', () => {
      withFixture((fixture, audit) => {
        const baselinePath = path.join(fixture, 'scripts/check-monorepo-boundaries.baseline.json')
        const one = "import { useWidgets } from '@/hooks/queries/widgets'\n"
        const two = `${one}import { useGears } from '@/ee/gears/hooks/gears'\n`

        writeFileSync(path.join(fixture, VIEW_FILE), two)
        expect(audit('--update').status).toBe(1)
        expect(audit('--update', '--init').status).toBe(0)
        expect(JSON.parse(readFileSync(baselinePath, 'utf8'))).toEqual({ [VIEW_FILE]: 2 })
        expect(audit().status).toBe(0)

        writeFileSync(
          path.join(fixture, VIEW_FILE),
          `${two}import { useCogs } from '@/ee/cogs/hooks/cogs'\n`
        )
        expect(audit().status).toBe(1)
        expect(audit('--update').status).toBe(1)
        expect(JSON.parse(readFileSync(baselinePath, 'utf8'))).toEqual({ [VIEW_FILE]: 2 })

        writeFileSync(path.join(fixture, VIEW_FILE), one)
        expect(audit().status).toBe(1)
        expect(audit('--update').status).toBe(0)
        expect(JSON.parse(readFileSync(baselinePath, 'utf8'))).toEqual({ [VIEW_FILE]: 1 })
        expect(audit().status).toBe(0)
      })
    })
  })
})
