import { describe, expect, it } from 'vitest'
import { typecheckSdkDirectory } from '../../test/typecheck-project'
import { generateWorkspaceTypes } from './workspace'

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

/**
 * Lays out a workspace directory as the CLI writes it and type-checks `check.ts` in it, beside
 * any `extra` declaration files.
 */
function typecheckWorkspace(check: string, extra: Record<string, string> = {}): string {
  return typecheckSdkDirectory(
    {
      '.sim/sdk/workspace.d.ts': generateWorkspaceTypes({ tableDeclarations: ['leads'] }).text,
      'tables/leads.ts': LEADS,
      'workflows/w/check.ts': check,
      ...extra,
    },
    ['tables/*.ts', 'knowledge/*/knowledge.ts', 'workflows/*/*.ts']
  )
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

  it('type a knowledge base declaration and reject an unknown chunking strategy', () => {
    const knowledgeBase = (chunking: string) => `// @sim-sdk 1
import { defineKnowledgeBase } from '@sim/workflow-sdk/workspace'

export default defineKnowledgeBase({
  name: 'Policies',
  folder: '/support',
  chunking: ${chunking},
  embeddingModel: 'text-embedding-3-small',
})
`
    const output = typecheckWorkspace('export {}\n', {
      'knowledge/good/knowledge.ts': knowledgeBase(
        "{ maxSize: 512, strategy: 'recursive', strategyOptions: { recipe: 'markdown' } }"
      ),
      'knowledge/bad/knowledge.ts': knowledgeBase("{ strategy: 'paragraph' }"),
    })
    expect(output).toContain('knowledge/bad/knowledge.ts')
    expect(output).toContain(`'"paragraph"' is not assignable`)
    expect(output).not.toContain('knowledge/good/knowledge.ts')
  }, 120_000)

  it('type MCP tool names per server, any name for a server it could not list', () => {
    const output = typecheckSdkDirectory(
      {
        '.sim/sdk/workspace.d.ts': generateWorkspaceTypes({
          mcpServers: { github: { tools: ['create_issue', 'list_issues'] }, docs: {} },
          mcpServerDeclarations: ['linear'],
        }).text,
        'mcp/linear.ts': `// @sim-sdk 1
import { defineMcpServer, env, stored } from '@sim/workflow-sdk/workspace'

export default defineMcpServer({
  url: 'https://mcp.linear.app/mcp',
  headers: { Authorization: env.LINEAR_TOKEN, Cookie: stored(), Accept: 'application/json' },
})
`,
        'workflows/w/check.ts': `import { mcp } from '@sim/workflow-sdk'
export const known = mcp('github').tool('create_issue')
export const unlisted = mcp('docs').tool('anything')
export const declared = mcp('linear').tool('anything')
export const misspelled = mcp('github').tool('crate_issue')
export const unknown = mcp('gitlab')
`,
      },
      ['mcp/*.ts', 'workflows/*/*.ts']
    )
    expect(output).toContain(`'"crate_issue"' is not assignable`)
    expect(output).toContain(`'"gitlab"' is not assignable`)
    expect(output.split('\n').filter((line) => line.includes('error TS'))).toHaveLength(2)
  }, 120_000)
})
