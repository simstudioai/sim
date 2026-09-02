/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { runEngine } from '@/lib/mothership/agent-cli/engines'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'

const SLACK_V2 = {
  id: 'slack_v2',
  name: 'Slack',
  triggers: [{ id: 'slack_webhook', configFields: { streamOutputs: { type: 'boolean' } } }],
  operations: { send_message: { toolId: 'slack_send' } },
}

function runtimeWith(responses: Record<string, unknown>): AgentCliRuntime {
  return {
    workspaceId: `ws-${Math.random().toString(36).slice(2)}`,
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

const CATALOG = {
  '/api/v2/blocks': { data: [{ id: 'slack_v2' }, { id: 'agent' }], nextCursor: null },
  '/api/v2/blocks/slack_v2': { data: SLACK_V2 },
  '/api/v2/blocks/agent': { data: { id: 'agent', name: 'Agent', inputSchema: [{ id: 'model' }] } },
}

describe('universal grep', () => {
  it('finds field ids inside block definitions and names the path-shaped line', async () => {
    const result = await runEngine('grep', ['stream'], runtimeWith(CATALOG), {
      scope: 'blocks',
      i: true,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('blocks/slack_v2:')
    expect(result.stdout).toContain('"streamOutputs"')
    expect(result.stdout).not.toContain('blocks/agent:')
  })

  it('narrows to one resource with --in and counts with --count', async () => {
    const within = await runEngine('grep', ['id'], runtimeWith(CATALOG), {
      scope: 'blocks',
      in: 'agent',
    })
    expect(within.stdout).toContain('blocks/agent:')
    expect(within.stdout).not.toContain('blocks/slack_v2:')
    const count = await runEngine('grep', ['id'], runtimeWith(CATALOG), {
      scope: 'blocks',
      count: true,
    })
    expect(count.stdout).toMatch(/^\d+ \(blocks=\d+\)$/)
  })

  it('accepts the world/resource path a match line prints as --in', async () => {
    const byPath = await runEngine('grep', ['id'], runtimeWith(CATALOG), { in: 'blocks/agent' })
    expect(byPath.exitCode).toBe(0)
    expect(byPath.stdout).toContain('blocks/agent:')
    expect(byPath.stdout).not.toContain('blocks/slack_v2:')
    const world = await runEngine('grep', ['id'], runtimeWith(CATALOG), { in: 'blocks' })
    expect(world.stdout).toContain('blocks/agent:')
    expect(world.stdout).toContain('blocks/slack_v2:')
  })

  it('refuses a prefixed --in selector before materializing any world', async () => {
    /** An empty runtime throws on any request, so the exact message proves nothing was fetched. */
    const result = await runEngine('grep', ['id'], runtimeWith({}), { in: 'workflow:abc-123' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown --in selector "workflow:abc-123"')
    expect(result.stderr).toContain('e.g. blocks/table_v2')
  })

  it.each(['knowledge', 'kb', 'KB', 'knowledge/kb-123'])(
    'redirects --in %s to semantic knowledge search before materializing any world',
    async (selector) => {
      /** An empty runtime throws on any request, so a clean refusal proves nothing was fetched. */
      const result = await runEngine('grep', ['invoice'], runtimeWith({}), { in: selector })
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(`Unknown --in selector ${JSON.stringify(selector)}`)
      expect(result.stderr).toContain(
        'Knowledge bases are searched semantically — use knowledge search --kb <id> --query "…"; grep covers workflows, blocks, tools, tables, files, integrations, skills, custom-tools, secrets, credentials.'
      )
    }
  )

  it('refuses an --in selector no resource in the searched worlds answers to', async () => {
    const bare = await runEngine('grep', ['id'], runtimeWith(CATALOG), {
      scope: 'blocks',
      in: 'nope-not-here',
    })
    expect(bare.exitCode).toBe(1)
    expect(bare.stderr).toContain('Unknown --in selector "nope-not-here"')
    const byPath = await runEngine('grep', ['id'], runtimeWith(CATALOG), { in: 'blocks/nope' })
    expect(byPath.exitCode).toBe(1)
    expect(byPath.stderr).toContain('Unknown --in selector "blocks/nope"')
  })

  it('still reports no matches for a resource that exists but has no hits', async () => {
    const result = await runEngine('grep', ['zzz-nope'], runtimeWith(CATALOG), {
      scope: 'blocks',
      in: 'agent',
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No matches for "zzz-nope" in blocks within "agent"')
  })

  it('refuses an unknown scope with a did-you-mean and the scope list', async () => {
    const result = await runEngine('grep', ['x'], runtimeWith({}), { scope: 'block' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Did you mean blocks')
    expect(result.stderr).toContain('workflows, blocks, tools')
  })

  it('materializes secrets as names only', async () => {
    const result = await runEngine(
      'grep',
      ['OPENAI'],
      runtimeWith({
        '/api/v2/secrets': {
          data: [{ name: 'OPENAI_API_KEY', value: 'sk-should-never-appear' }],
          nextCursor: null,
        },
      }),
      { scope: 'secrets' }
    )
    expect(result.stdout).toContain('OPENAI_API_KEY')
    expect(result.stdout).not.toContain('sk-should-never-appear')
  })

  it('reports no matches honestly', async () => {
    const result = await runEngine('grep', ['zzz-nope'], runtimeWith(CATALOG), { scope: 'blocks' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No matches for "zzz-nope" in blocks')
  })

  it('names files by their VFS path, with no doubled slash at the root', async () => {
    const result = await runEngine(
      'grep',
      ['runbook'],
      runtimeWith({
        '/api/v2/files': {
          data: [
            { id: 'file-root', name: 'xp-runbook.md', folderPath: '/' },
            { id: 'file-ops', name: 'notes.md', folderPath: '/Ops' },
          ],
          nextCursor: null,
        },
        '/api/v2/files/file-root/text': { data: { text: 'root runbook', degraded: false } },
        '/api/v2/files/file-ops/text': { data: { text: 'ops runbook', degraded: false } },
      }),
      { scope: 'files' }
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('files/xp-runbook.md (file-root):')
    expect(result.stdout).toContain('files/Ops/notes.md (file-ops):')
    expect(result.stdout).not.toContain('files//')
  })
})
