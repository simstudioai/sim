import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withStaleTableHints } from './source-types'
import type { Diagnostic } from './source-ui'

let dir: string

/** Keeps a manifest with these tables' columns, as a get leaves it beside `workspace.d.ts`. */
function keep(tables: Record<string, string[]>) {
  mkdirSync(join(dir, '.sim/sdk'), { recursive: true })
  const manifest = {
    tables: Object.fromEntries(
      Object.entries(tables).map(([key, columns]) => [
        key,
        { columns: Object.fromEntries(columns.map((name) => [name, { type: 'string' }])) },
      ])
    ),
  }
  writeFileSync(join(dir, '.sim/sdk/workspace.manifest.json'), JSON.stringify(manifest))
}

function excess(property: string, members: string): Diagnostic {
  return {
    code: 'E_TYPE',
    severity: 'error',
    message: `TS2353: Object literal may only specify known properties, and '${property}' does not exist in type '{} & { ${members} }'.`,
  }
}

async function hintFor(finding: Diagnostic) {
  const [hinted] = await withStaleTableHints([finding], dir)
  return hinted.hint
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-stale-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the refresh hint on a row write naming a column the stored table lacks', () => {
  it('names no table when two stored tables both fit the printed row', async () => {
    keep({ tickets: ['subject', 'body'], archive: ['subject', 'body'] })
    const hint = await hintFor(
      excess('category', 'body?: Value<string> | undefined; subject?: Value<string> | undefined;')
    )
    expect(hint).toContain('sim workflows source status')
    expect(hint).not.toMatch(/table "(tickets|archive)"/)
  })

  it('names the one table whose columns are exactly the printed row', async () => {
    keep({ tickets: ['subject', 'body'], wide: ['subject', 'body', 'owner'] })
    const hint = await hintFor(
      excess('category', 'body?: Value<string> | undefined; subject?: Value<string> | undefined;')
    )
    expect(hint).toContain('table "tickets"')
  })

  it('reads a single-quoted column name', async () => {
    keep({ other: ['subject'], tickets: ['due date', 'subject'] })
    const hint = await hintFor(
      excess(
        'category',
        "'due date'?: Value<string> | undefined; subject?: Value<string> | undefined;"
      )
    )
    expect(hint).toContain('table "tickets"')
  })

  it('quotes a directory the shell would split', async () => {
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'sim stale '))
    keep({ tickets: ['subject'] })
    const hint = await hintFor(excess('category', 'subject?: Value<string> | undefined;'))
    expect(hint).toContain(`sim workflows source status --dir '${dir}'`)
  })
})
