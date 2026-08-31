/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  agentCliHelpSection,
  executeAgentCliCommand,
  isRootHelpInvocation,
  matchAgentCliCommand,
} from '@/lib/mothership/tools/handlers/agent-cli'
import type { AgentCliRuntime } from '@/lib/mothership/tools/handlers/agent-cli/types'

const WORKFLOW_STATE = {
  blocks: {
    'block-1': { type: 'starter', name: 'Start', enabled: true },
    'block-2': { type: 'agent', name: 'Summarize emails', enabled: true },
  },
  edges: [{ source: 'block-1', target: 'block-2', sourceHandle: 'source', id: 'edge-1' }],
  variables: { apiBase: 'https://api.example.com' },
}

function runtimeWith(responses: Record<string, unknown>): AgentCliRuntime {
  return {
    workspaceId: 'ws-1',
    client: {
      request: async <T>(path: string): Promise<T> => {
        const hit = responses[path]
        if (hit === undefined) throw new Error(`Unexpected request: ${path}`)
        return hit as T
      },
    },
  }
}

const EXPORT_PATH = '/api/v2/workflows/wf-1/export'
const exportResponse = { data: { state: WORKFLOW_STATE } }

describe('agent-cli routing', () => {
  it('matches agent commands through leading global flags', () => {
    const match = matchAgentCliCommand(['--output', 'json', 'workflow', 'edges', 'wf-1'])
    expect(match?.command.path).toEqual(['workflow', 'edges'])
    expect(match?.rest).toEqual(['wf-1'])
  })

  it('leaves real CLI commands unmatched', () => {
    expect(matchAgentCliCommand(['workflows', 'list'])).toBeNull()
    expect(matchAgentCliCommand(['tables', 'get', 'tbl_1'])).toBeNull()
  })

  it('detects root help invocations only', () => {
    expect(isRootHelpInvocation(['--help'])).toBe(true)
    expect(isRootHelpInvocation(['--output', 'json', 'help'])).toBe(true)
    expect(isRootHelpInvocation(['workflows', '--help'])).toBe(false)
  })

  it('lists every registered command in the help section', () => {
    const section = agentCliHelpSection()
    for (const usage of ['workflow blocks', 'workflow edges', 'workflow grep', 'workflows grep']) {
      expect(section).toContain(usage)
    }
  })
})

describe('workflow views', () => {
  it('projects just the blocks', async () => {
    const match = matchAgentCliCommand(['workflow', 'blocks', 'wf-1'])
    const result = await executeAgentCliCommand(
      match!,
      runtimeWith({ [EXPORT_PATH]: exportResponse })
    )
    expect(result.exitCode).toBe(0)
    const blocks = JSON.parse(result.stdout)
    expect(blocks).toEqual([
      { id: 'block-1', type: 'starter', name: 'Start', enabled: true },
      { id: 'block-2', type: 'agent', name: 'Summarize emails', enabled: true },
    ])
  })

  it('projects just the edges', async () => {
    const match = matchAgentCliCommand(['workflow', 'edges', 'wf-1'])
    const result = await executeAgentCliCommand(
      match!,
      runtimeWith({ [EXPORT_PATH]: exportResponse })
    )
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([
      { source: 'block-1', target: 'block-2', sourceHandle: 'source' },
    ])
  })

  it('fails usefully without a workflow id', async () => {
    const match = matchAgentCliCommand(['workflow', 'blocks'])
    const result = await executeAgentCliCommand(match!, runtimeWith({}))
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage:')
  })
})

describe('workflow grep', () => {
  it('reports matches as path: value lines', async () => {
    const match = matchAgentCliCommand(['workflow', 'grep', 'wf-1', 'Summarize'])
    const result = await executeAgentCliCommand(
      match!,
      runtimeWith({ [EXPORT_PATH]: exportResponse })
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('.blocks.block-2.name: Summarize emails')
  })

  it('falls back to literal search on an invalid regex', async () => {
    const match = matchAgentCliCommand(['workflow', 'grep', 'wf-1', 'api.example.com['])
    const result = await executeAgentCliCommand(
      match!,
      runtimeWith({ [EXPORT_PATH]: exportResponse })
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('No matches.')
  })

  it('searches across all workspace workflows', async () => {
    const match = matchAgentCliCommand(['workflows', 'grep', 'Summarize'])
    const result = await executeAgentCliCommand(
      match!,
      runtimeWith({
        '/api/v2/workflows': {
          data: [{ id: 'wf-1', name: 'Email digest' }],
          nextCursor: null,
        },
        [EXPORT_PATH]: exportResponse,
      })
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Email digest (wf-1).blocks.block-2.name: Summarize emails')
  })

  it('surfaces execution errors as a failed result, never a throw', async () => {
    const match = matchAgentCliCommand(['workflow', 'grep', 'wf-missing', 'x'])
    const result = await executeAgentCliCommand(match!, runtimeWith({}))
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unexpected request')
  })
})
