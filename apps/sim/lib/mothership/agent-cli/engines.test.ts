/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { buildWorkflowLintReport } = vi.hoisted(() => ({
  buildWorkflowLintReport: vi.fn().mockResolvedValue({
    sources: ['block-1'],
    sinks: ['block-2'],
    orphanBlocks: [],
    emptyOutgoingPorts: [],
    invalidBranchPorts: [],
    invalidConnectionTargets: [],
    fieldIssues: [
      {
        blockId: 'block-2',
        blockName: 'Summarize emails',
        missingRequiredFields: ['model'],
        inactiveModeValues: [],
      },
    ],
    unresolvedReferences: [],
  }),
}))

vi.mock('@/lib/workflows/editing/lint-report', () => ({ buildWorkflowLintReport }))

import { runEngine } from '@/lib/mothership/agent-cli/engines'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'

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
    userId: 'user-1',
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

describe('workflow views', () => {
  it('projects just the blocks', async () => {
    const result = await runEngine(
      'workflow blocks',
      ['wf-1'],
      runtimeWith({ [EXPORT_PATH]: exportResponse }),
      {}
    )
    expect(result.exitCode).toBe(0)
    const blocks = JSON.parse(result.stdout)
    expect(blocks).toEqual([
      { id: 'block-1', type: 'starter', name: 'Start', enabled: true },
      { id: 'block-2', type: 'agent', name: 'Summarize emails', enabled: true },
    ])
  })

  it('projects just the edges', async () => {
    const result = await runEngine(
      'workflow edges',
      ['wf-1'],
      runtimeWith({ [EXPORT_PATH]: exportResponse }),
      {}
    )
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([
      { source: 'block-1', target: 'block-2', sourceHandle: 'source' },
    ])
  })

  it('fails usefully without a workflow id', async () => {
    const result = await runEngine('workflow blocks', [], runtimeWith({}), {})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage:')
  })
})

describe('files grep', () => {
  const FILES_LIST = {
    data: [
      { id: 'f1', name: 'report.md', folderPath: 'docs' },
      { id: 'f2', name: 'logo.png', folderPath: '' },
    ],
    nextCursor: null,
  }
  const readText = (text: string, degraded = false) => ({
    data: { text, degraded },
  })

  it('greps file contents with line numbers, skipping non-text files', async () => {
    const result = await runEngine(
      'files grep',
      ['quarterly'],
      runtimeWith({
        '/api/v2/files': FILES_LIST,
        '/api/v2/files/f1/text': readText('# Report\nQuarterly revenue was up.\n'),
        '/api/v2/files/f2/text': readText('', true),
      }),
      {}
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('docs/report.md:2: Quarterly revenue was up.')
    expect(result.stdout).not.toContain('logo.png')
  })

  it('filters by folder prefix', async () => {
    const result = await runEngine(
      'files grep',
      ['Quarterly', 'other'],
      runtimeWith({ '/api/v2/files': FILES_LIST }),
      {}
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No matches')
  })
})

describe('workflow grep', () => {
  it('reports matches as path: value lines', async () => {
    const result = await runEngine(
      'workflow grep',
      ['wf-1', 'Summarize'],
      runtimeWith({ [EXPORT_PATH]: exportResponse }),
      {}
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('.blocks.block-2.name: Summarize emails')
  })

  it('falls back to literal search on an invalid regex', async () => {
    const result = await runEngine(
      'workflow grep',
      ['wf-1', 'api.example.com['],
      runtimeWith({ [EXPORT_PATH]: exportResponse }),
      {}
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('No matches.')
  })

  it('searches across all workspace workflows', async () => {
    const result = await runEngine(
      'workflows grep',
      ['Summarize'],
      runtimeWith({
        '/api/v2/workflows': {
          data: [{ id: 'wf-1', name: 'Email digest' }],
          nextCursor: null,
        },
        [EXPORT_PATH]: exportResponse,
      }),
      {}
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Email digest (wf-1).blocks.block-2.name: Summarize emails')
  })

  it('lints a workflow through the shared engine with the caller scoped as subject', async () => {
    const result = await runEngine(
      'workflow lint',
      ['wf-1'],
      runtimeWith({ [EXPORT_PATH]: exportResponse }),
      {}
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.fieldIssues).toHaveLength(1)
    expect(report.summary.length).toBeGreaterThan(0)
    expect(buildWorkflowLintReport).toHaveBeenCalledWith(expect.anything(), {
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      subjectUserId: 'user-1',
    })
  })

  it('surfaces execution errors as a failed result, never a throw', async () => {
    const result = await runEngine('workflow grep', ['wf-missing', 'x'], runtimeWith({}), {})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unexpected request')
  })
})
