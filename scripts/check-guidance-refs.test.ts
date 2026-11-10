import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  dollarSkills,
  spanIdentifier,
  withoutHistoryColumn,
  withoutPlaceholders,
} from './check-guidance-refs'

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

describe('withoutPlaceholders', () => {
  it('blanks a lowercase or SCREAMING placeholder and the word it is part of, and keeps a JSX tag', () => {
    expect(withoutPlaceholders('set <FLAG_SECRET> and <name>MockFns')).toBe('set   and  ')
    expect(withoutPlaceholders('render <SettingsPanel /> or <Row>')).toBe(
      'render <SettingsPanel /> or <Row>'
    )
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

function withFixture(
  run: (put: (file: string, content: string) => void, audit: () => Audit) => void
) {
  const root = mkdtempSync(path.join(tmpdir(), 'sim-guidance-refs-'))
  const put = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  try {
    spawnSync('git', ['init', '-q'], { cwd: root })
    put(
      'package.json',
      JSON.stringify({ name: 'fixture', workspaces: [], scripts: { 'check:panel': 'true' } })
    )
    put('src/panel.ts', 'export const PanelRows = 1\nexport function usePanelRows() {}\n')
    put('apps/sim/lib/panel.ts', 'export const panel = 1\n')
    put('apps/sim/app/(product)/o/[organizationId]/home/page.tsx', 'export default null\n')
    put('apps/sim/app/workspace/[workspaceId]/page.tsx', 'export default null\n')
    run(put, () => {
      const result = spawnSync('bun', [CHECK, root], { encoding: 'utf8' })
      return { status: result.status, output: result.stdout + result.stderr }
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

interface Audit {
  status: number | null
  output: string
}

/** Lines every fixture's guidance carries, all of which resolve. */
const LIVE = [
  'Render `PanelRows` with `usePanelRows()` from `panel.ts` in `apps/sim/lib/panel.ts`.',
  'Import `@/lib/panel`, run `bun run check:panel`, and edit `o/[organizationId]/home/page.tsx`.',
  'Each page sits at `workspace/[workspaceId]/<page>`; set `<FLAG_SECRET>` and `<name>MockFns`.',
  '```ts',
  'const LocalExample = usePanelRows()',
  '```',
  '```ts illustrative',
  'const shown = MadeUpHelper()',
  '```',
  '```bash',
  'SHIP_REF=$(git rev-parse HEAD) && grep -niE "x" file',
  '```',
]

it('passes guidance whose every reference resolves, placeholders and shell fences included', () => {
  withFixture((put, audit) => {
    put('AGENTS.md', `${LIVE.join('\n')}\n`)
    expect(audit()).toEqual({ status: 0, output: expect.stringContaining('resolve') })
  })
})

describe('fails each kind of dead reference', () => {
  const cases = [
    ['path', 'Edit `apps/sim/lib/gone.ts`.', '[path] apps/sim/lib/gone.ts'],
    ['path, from a product route', 'Edit `o/[organizationId]/gone/page.tsx`.', '[path] o/'],
    [
      'path, up to its first placeholder',
      'Pages sit at `app/gone/[workspaceId]/<page>`.',
      '[path] app/gone/[workspaceId]/<page>',
    ],
    ['script', 'Run `bun run check:gone`.', '[script] check:gone'],
    ['import', 'Import `@/lib/gone`.', '[import] @/lib/gone'],
    ['file', 'Read `gone-order.test.ts`.', '[file] gone-order.test.ts'],
    ['identifier', 'Use `GoneLayout`.', '[identifier] GoneLayout'],
    ['identifier, in a code fence', '```ts\nMissingHelper()\n```', '[identifier] MissingHelper'],
  ] as const
  it.each(cases)('%s', (_kind, line, finding) => {
    withFixture((put, audit) => {
      put('AGENTS.md', `${[...LIVE, line].join('\n')}\n`)
      const result = audit()
      expect(result.status).toBe(1)
      expect(result.output).toContain(finding)
    })
  })

  it('rule glob', () => {
    withFixture((put, audit) => {
      put('AGENTS.md', `${LIVE.join('\n')}\n`)
      put(
        '.claude/rules/gone.md',
        '---\ndescription: Gone\npaths:\n  - "apps/gone/**/*.ts"\n---\n\n# Gone\n'
      )
      const result = audit()
      expect(result.status).toBe(1)
      expect(result.output).toContain('[path] apps/gone/**/*.ts')
    })
  })
})
