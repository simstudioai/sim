import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { typecheck } from '../../test/typecheck-project'
import { CORE_DTS } from './core-text.generated'
import { generateWorkspaceTypes } from './workspace'
import { WORKSPACE_SDK_DTS } from './workspace-text.generated'

const LEADS = `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'leads',
  columns: {
    email: column.string({ required: true }),
    status: column.select({ options: ['new', 'won'] }),
    tags: column.select({ options: ['a', 'b'], multiple: true }),
    score: column.number({ name: 'lead_score' }),
  },
})
`

/** Lays out a workspace directory as the CLI writes it and type-checks `check.ts` in it. */
function typecheckWorkspace(check: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sim-workspace-types-'))
  try {
    const write = (file: string, text: string) => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      writeFileSync(path.join(dir, file), text)
    }
    write('.sim/sdk/core.d.ts', CORE_DTS)
    for (const [name, text] of Object.entries(WORKSPACE_SDK_DTS)) {
      write(`.sim/sdk/workspace/${name}`, text)
    }
    write('.sim/sdk/workspace.d.ts', generateWorkspaceTypes({ tableDeclarations: ['leads'] }).text)
    write('tables/leads.ts', LEADS)
    write('workflows/w/check.ts', check)
    write(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          moduleDetection: 'force',
          types: [],
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          paths: {
            '@sim/workflow-sdk': ['./.sim/sdk/core.d.ts'],
            '@sim/workflow-sdk/workspace': ['./.sim/sdk/workspace/index.d.ts'],
          },
        },
        include: ['tables/*.ts', 'workflows/*/*.ts', '.sim/sdk/**/*.d.ts'],
      })
    )
    return typecheck(path.join(dir, 'tsconfig.json'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('workspace declarations', () => {
  it('type a workflow against a table declared in the same directory, by stored column name', () => {
    const output = typecheckWorkspace(`import type { TableColumns } from '@sim/workflow-sdk'
type Row = TableColumns<'leads'>
export const row: Row = { email: 'a@b.c', status: 'won', tags: ['a', 'b'], lead_score: 3 }
`)
    expect(output).toBe('')
  }, 120_000)

  it('reject an option the declaration does not list and a column it does not declare', () => {
    const output = typecheckWorkspace(`import type { TableColumns } from '@sim/workflow-sdk'
type Row = TableColumns<'leads'>
export const badOption: Row = { email: 'a', status: 'lost', tags: [], lead_score: 1 }
export const badColumn: Row = { email: 'a', status: 'new', tags: [], score: 1 }
`)
    expect(output).toContain(`'"lost"' is not assignable`)
    expect(output).toContain(`'score' does not exist`)
  }, 120_000)
})
