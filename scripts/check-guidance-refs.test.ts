import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { dollarSkills, spanIdentifier, withoutHistoryColumn } from './check-guidance-refs'

const CHECK = fileURLToPath(new URL('./check-guidance-refs.ts', import.meta.url))

describe('dollarSkills', () => {
  it('reads a hyphenated $skill reference and leaves query operators alone', () => {
    expect(dollarSkills('Load $sim-paper-design first, then `$add-block`.')).toEqual([
      'sim-paper-design',
      'add-block',
    ])
    expect(dollarSkills('Pass $filter and $select; read $HOME')).toEqual([])
  })
})

describe('withoutHistoryColumn', () => {
  it("blanks a table's Legacy source cells and keeps every other cell and table", () => {
    expect(
      withoutHistoryColumn([
        '| Capability | Legacy source | Status | Proof or reason |',
        '| --- | --- | --- | --- |',
        '| Roles | `apps/sim/gone.tsx` | Done | `apps/sim/kept.test.ts` |',
        '',
        '| Name | Path |',
        '| Roles | `apps/sim/gone.tsx` |',
      ])
    ).toEqual([
      '| Capability | Legacy source | Status | Proof or reason |',
      '| --- | | --- | --- |',
      '| Roles | | Done | `apps/sim/kept.test.ts` |',
      '',
      '| Name | Path |',
      '| Roles | `apps/sim/gone.tsx` |',
    ])
  })
})

describe('spanIdentifier', () => {
  it('reads an identifier-shaped span, called or as a tag, and leaves words and libraries alone', () => {
    expect(spanIdentifier('GoneLayout')).toBe('GoneLayout')
    expect(spanIdentifier('goneActions()')).toBe('goneActions')
    expect(spanIdentifier('<GoneChips />')).toBe('GoneChips')
    expect(spanIdentifier('GONE_GRID')).toBe('GONE_GRID')
    for (const span of ['Button', 'URL', 'loading', 'FF6B6B', 'useScroll', 'a b', 'x.y'])
      expect(spanIdentifier(span)).toBeUndefined()
  })
})

it('fails a bare file name or identifier no tracked file has, and holds the baseline to shrinking', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sim-guidance-refs-'))
  const put = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  const run = (...args: string[]) => {
    const result = spawnSync('bun', [CHECK, root, ...args], { encoding: 'utf8' })
    return { status: result.status, output: result.stdout + result.stderr }
  }
  try {
    spawnSync('git', ['init', '-q'], { cwd: root })
    put('package.json', JSON.stringify({ name: 'fixture', workspaces: [] }))
    put('src/panel.ts', 'export const PanelRows = 1\nexport function usePanelRows() {}\n')
    const guidance = [
      'Render `PanelRows` with `usePanelRows()` from `panel.ts`.',
      '```ts',
      'const LocalExample = usePanelRows()',
      '```',
      '```ts illustrative',
      'const shown = MadeUpHelper()',
      '```',
    ]
    put('AGENTS.md', `${guidance.join('\n')}\n`)
    expect(run()).toEqual({ status: 0, output: expect.stringContaining('resolve') })

    put(
      'AGENTS.md',
      `${[...guidance, 'Use `GoneLayout` and `gone-order.test.ts`.', '```ts', 'MissingHelper()', '```'].join('\n')}\n`
    )
    const failing = run()
    expect(failing.status).toBe(1)
    for (const finding of [
      'AGENTS.md:8  [identifier] GoneLayout',
      'AGENTS.md:8  [file] gone-order.test.ts',
      'AGENTS.md:10  [identifier] MissingHelper',
    ])
      expect(failing.output).toContain(finding)
    expect(failing.output).not.toContain('MadeUpHelper')
    expect(failing.output).not.toContain('LocalExample')

    put('scripts/check-guidance-refs.baseline.json', '[]')
    expect(run('--update', '--init').status).toBe(0)
    expect(run().status).toBe(0)

    put('AGENTS.md', `${[...guidance, 'Use `GoneLayout`.'].join('\n')}\n`)
    const stale = run()
    expect(stale.status).toBe(1)
    expect(stale.output).toContain('fixed: AGENTS.md gone-order.test.ts')
    expect(run('--update').status).toBe(0)
    expect(run().status).toBe(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
