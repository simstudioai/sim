/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { execute } = vi.hoisted(() => ({
  execute: vi
    .fn()
    .mockResolvedValue({ results: [{ path: 'docs/integrations/slack.mdx' }], query: 'q' }),
}))
vi.mock('@/lib/mothership/environment-context', () => ({
  prepareCopilotEnvironmentContext: vi.fn(async () => ({
    resolvedSecretTraceRegistry: { registry: 'stub' },
  })),
}))

vi.mock('@/lib/mothership/tools/server/docs/search-docs', () => ({
  searchDocsServerTool: { execute },
}))

import { runEngine } from '@/lib/mothership/agent-cli/engines'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'

const runtime: AgentCliRuntime = {
  workspaceId: 'ws-1',
  userId: 'user-1',
  client: { request: async () => ({}) as never },
}

describe('docs search engine', () => {
  it('joins the query words and maps --top/--path onto the docs search tool', async () => {
    const result = await runEngine('docs search', ['slack', 'streaming'], runtime, {
      top: '3',
      path: 'docs/integrations',
    })
    expect(result.exitCode).toBe(0)
    expect(execute).toHaveBeenCalledWith(
      { query: 'slack streaming', topK: 3, path: 'docs/integrations' },
      { userId: 'user-1', workspaceId: 'ws-1', resolvedSecretTraceRegistry: { registry: 'stub' } }
    )
    expect(JSON.parse(result.stdout).results[0].path).toBe('docs/integrations/slack.mdx')
  })

  it('fails usefully without a query or with a bad --top', async () => {
    expect((await runEngine('docs search', [], runtime, {})).exitCode).toBe(1)
    expect((await runEngine('docs search', ['x'], runtime, { top: 'many' })).exitCode).toBe(1)
  })
})
