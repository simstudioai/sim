/**
 * @vitest-environment node
 */
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListCatalogTools, mockReadBlockCatalog } = vi.hoisted(() => ({
  mockListCatalogTools: vi.fn(),
  mockReadBlockCatalog: vi.fn(),
}))
vi.mock('@/lib/catalog/application/read-block-catalog', () => ({
  readBlockCatalog: { execute: mockReadBlockCatalog },
}))
vi.mock('@/lib/catalog/application/list-tools', () => ({
  listCatalogTools: { execute: mockListCatalogTools },
}))

import { runEngine } from '@/lib/mothership/agent-cli/engines'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'

const SLACK_V2 = {
  id: 'slack_v2',
  name: 'Slack',
  triggers: [{ id: 'slack_webhook', configFields: { streamOutputs: { type: 'boolean' } } }],
  operations: { send_message: { toolId: 'slack_send' } },
}

function runtimeWith(
  responses: Record<string, unknown>,
  requested: string[] = []
): AgentCliRuntime {
  return {
    workspaceId: `ws-${generateId()}`,
    userId: 'user-1',
    client: {
      request: async <T>(path: string): Promise<T> => {
        requested.push(path)
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

function runtimeWithFilePages(count: number, requested: string[]): AgentCliRuntime {
  const files = Array.from({ length: count }, (_, i) => ({ id: `f${i}`, name: `f${i}.txt` }))
  return {
    ...runtimeWith({}),
    client: {
      request: async <T>(
        path: string,
        options?: { query?: Record<string, string> }
      ): Promise<T> => {
        requested.push(path)
        if (path === '/api/v2/files') {
          const offset = Number(options?.query?.cursor ?? 0)
          return {
            data: files.slice(offset, offset + 100),
            nextCursor: offset + 100 < count ? String(offset + 100) : null,
          } as T
        }
        return { data: { text: 'needle', degraded: false, truncated: false } } as T
      },
    },
  }
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

  it('settles a bare --in that is a block id without listing any workspace world', async () => {
    // `grep x --in file_v5` used to materialize every searched world to find one block —
    // 65 block details plus every workflow state; on dev that took 18-34s per call and
    // tripped the per-user rate limit. An exact platform id now resolves from the
    // memoized catalog alone.
    const requested: string[] = []
    const runtime = runtimeWith(
      {
        ...CATALOG,
        '/api/v2/workflows': { data: [{ id: 'wf-1', name: 'Agent runner' }], nextCursor: null },
      },
      requested
    )
    const result = await runEngine('grep', ['id'], runtime, {
      scope: 'blocks,workflows',
      in: 'agent',
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('blocks/agent:')
    expect(requested).toContain('/api/v2/blocks/agent')
    expect(requested).not.toContain('/api/v2/workflows')
  })

  it('resolves a bare --in name fragment against the listings and fetches only the matches', async () => {
    const requested: string[] = []
    const runtime = runtimeWith(
      {
        ...CATALOG,
        '/api/v2/workflows': {
          data: [
            { id: 'wf-1', name: 'Agent runner' },
            { id: 'wf-2', name: 'Nightly digest' },
          ],
          nextCursor: null,
        },
        '/api/v2/workflows/wf-1/state': { data: { blocks: { b1: { type: 'agent' } } } },
      },
      requested
    )
    const result = await runEngine('grep', ['type'], runtime, {
      scope: 'blocks,workflows',
      in: 'runner',
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('workflows/Agent runner (wf-1):')
    expect(requested).toContain('/api/v2/workflows/wf-1/state')
    expect(requested).not.toContain('/api/v2/workflows/wf-2/state')
    /** A new invocation rechecks the caller’s current catalog. */
    const listed = () => requested.filter((path) => path === '/api/v2/blocks').length
    expect(listed()).toBe(1)
    await runEngine('grep', ['type'], runtime, { scope: 'blocks,workflows', in: 'runner' })
    expect(listed()).toBe(2)
  })

  it('uses one fresh bulk catalog read per concurrent authorized grep', async () => {
    const requested: string[] = []
    const runtime = {
      ...runtimeWith({}, requested),
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session' } as const,
    }
    mockReadBlockCatalog.mockResolvedValue({ blocks: [SLACK_V2] })
    const results = await Promise.all([
      runEngine('grep', ['streamOutputs'], runtime, { scope: 'blocks' }),
      runEngine('grep', ['streamOutputs'], runtime, { scope: 'blocks' }),
      runEngine('grep', ['streamOutputs'], runtime, { scope: 'blocks' }),
    ])
    for (const result of results) expect(result.stdout).toContain('streamOutputs')
    expect(mockReadBlockCatalog).toHaveBeenCalledTimes(3)
    expect(requested).toEqual([])
  })

  it('bounds the nested requests in flight across the whole process', async () => {
    const ids = Array.from({ length: 24 }, (_, i) => `block_${i}`)
    const responses: Record<string, unknown> = {
      '/api/v2/blocks': { data: ids.map((id) => ({ id })), nextCursor: null },
    }
    for (const id of ids) responses[`/api/v2/blocks/${id}`] = { data: { id, inputSchema: [] } }
    let inFlight = 0
    let peak = 0
    const runtime: AgentCliRuntime = {
      workspaceId: `ws-${generateId()}`,
      userId: 'user-1',
      client: {
        request: async <T>(path: string): Promise<T> => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          await sleep(2)
          inFlight -= 1
          return responses[path] as T
        },
      },
    }
    await Promise.all([
      runEngine('grep', ['id'], runtime, { scope: 'blocks' }),
      runEngine('grep', ['id'], runtime, { scope: 'blocks' }),
    ])
    expect(peak).toBeLessThanOrEqual(8)
  })

  it('re-authorizes file text on each invocation even when the listed version is unchanged', async () => {
    const requested: string[] = []
    const file = { id: 'wf_1', name: 'notes.md', folderPath: '/', updatedAt: 't1', size: 12 }
    const responses: Record<string, unknown> = {
      '/api/v2/files': { data: [file], nextCursor: null },
      '/api/v2/files/wf_1/text': { data: { text: 'alpha beta', degraded: false } },
    }
    const runtime = runtimeWith(responses, requested)
    await runEngine('grep', ['alpha'], runtime, { scope: 'files' })
    await runEngine('grep', ['beta'], runtime, { scope: 'files' })
    expect(requested.filter((path) => path === '/api/v2/files/wf_1/text')).toHaveLength(2)
    responses['/api/v2/files'] = { data: [{ ...file, updatedAt: 't2' }], nextCursor: null }
    await runEngine('grep', ['beta'], runtime, { scope: 'files' })
    expect(requested.filter((path) => path === '/api/v2/files/wf_1/text')).toHaveLength(3)
  })

  it('honours -A and -B as asymmetric context, not only -C', async () => {
    const runtime = runtimeWith({
      '/api/v2/blocks': { data: [{ id: 'agent' }], nextCursor: null },
      '/api/v2/blocks/agent': {
        data: { id: 'agent', name: 'Agent', inputSchema: [{ id: 'model' }, { id: 'files' }] },
      },
    })
    const after = await runEngine('grep', ['"id": "model"'], runtime, {
      scope: 'blocks',
      in: 'agent',
      A: '4',
    })
    expect(after.stdout).toContain('"id": "model"')
    expect(after.stdout).toContain('"id": "files"')
    const before = await runEngine('grep', ['"id": "files"'], runtime, {
      scope: 'blocks',
      in: 'agent',
      B: '4',
    })
    expect(before.stdout).toContain('"id": "model"')
    const bad = await runEngine('grep', ['x'], runtime, { scope: 'blocks', A: 'lots' })
    expect(bad.stderr).toContain('-A needs a non-negative number')
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

  it('matches a resource by its own name, not only its body', async () => {
    // `grep fx-` in an fx-* workspace found nothing: a workflow's state carries no name.
    const result = await runEngine(
      'grep',
      ['fx-etl'],
      runtimeWith({
        '/api/v2/workflows': { data: [{ id: 'wf-1', name: 'fx-etl' }], nextCursor: null },
        '/api/v2/workflows/wf-1/state': { data: { blocks: {}, edges: [] } },
      }),
      { scope: 'workflows' }
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('workflows/fx-etl (wf-1):')
    expect(result.stdout).toContain('name: fx-etl')
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

describe('tools world', () => {
  it('reads the whole catalog in one use-case call when the runtime carries a principal', async () => {
    mockListCatalogTools.mockResolvedValueOnce({
      entries: [{ id: 'slack_send', name: 'Send message', description: 'Post to Slack' }],
      hasMore: false,
      offset: 0,
      limit: 100_000,
    })
    const requested: string[] = []
    const runtime = {
      ...runtimeWith({}, requested),
      principal: { kind: 'session', userId: 'user-1', sessionId: 's-1' } as const,
    }
    const result = await runEngine('grep', ['Slack'], runtime, { scope: 'tools' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('tools/slack_send:')
    expect(requested).toEqual([])
    expect(mockListCatalogTools).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ workspaceId: runtime.workspaceId }),
      })
    )
  })

  it('pages the catalog through the client when no principal is present', async () => {
    const requested: string[] = []
    const runtime = runtimeWith(
      { '/api/v2/tools': { data: [{ id: 'slack_send', name: 'Send message' }], nextCursor: null } },
      requested
    )
    const result = await runEngine('grep', ['slack_send'], runtime, { scope: 'tools' })
    expect(result.stdout).toContain('tools/slack_send:')
    expect(requested).toContain('/api/v2/tools')
  })
})

describe('search authority and completeness', () => {
  beforeEach(() => mockListCatalogTools.mockReset())
  it('does not reuse one actor’s catalog for another actor in the same workspace', async () => {
    const first = {
      ...runtimeWith({}),
      principal: { kind: 'session', userId: 'alice', sessionId: 'a' } as const,
    }
    const second = {
      ...runtimeWith({}),
      workspaceId: first.workspaceId,
      userId: 'bob',
      principal: { kind: 'session', userId: 'bob', sessionId: 'b' } as const,
    }
    mockListCatalogTools.mockResolvedValueOnce({
      entries: [{ id: 'private_preview', name: 'ALICE_ONLY' }],
      hasMore: false,
    })
    mockListCatalogTools.mockResolvedValueOnce({ entries: [], hasMore: false })
    expect((await runEngine('grep', ['ALICE_ONLY'], first, { scope: 'tools' })).stdout).toContain(
      'ALICE_ONLY'
    )
    const result = await runEngine('grep', ['ALICE_ONLY'], second, { scope: 'tools', count: true })
    expect(result.stdout).toBe('0')
  })

  it('checks current catalog authority again after a previous successful search', async () => {
    const runtime = {
      ...runtimeWith({}),
      principal: { kind: 'session', userId: 'reader', sessionId: 's' } as const,
    }
    mockListCatalogTools.mockResolvedValueOnce({
      entries: [{ id: 'private_preview', name: 'PREVIEW' }],
      hasMore: false,
    })
    expect((await runEngine('grep', ['PREVIEW'], runtime, { scope: 'tools' })).stdout).toContain(
      'PREVIEW'
    )
    mockListCatalogTools.mockRejectedValueOnce(new Error('Workspace access revoked'))
    const result = await runEngine('grep', ['PREVIEW'], runtime, { scope: 'tools' })
    expect(result.exitCode).toBe(1)
  })

  it('does not report failed file reads as a complete search with zero matches', async () => {
    const result = await runEngine(
      'grep',
      ['needle'],
      runtimeWith({
        '/api/v2/files': { data: [{ id: 'broken', name: 'broken.txt' }], nextCursor: null },
      }),
      { scope: 'files' }
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/incomplete/i)
    expect(result.stderr).toContain('broken')
  })

  it('reports truncated extraction even when a returned prefix has a match', async () => {
    const result = await runEngine(
      'grep',
      ['needle'],
      runtimeWith({
        '/api/v2/files': { data: [{ id: 'short', name: 'long.txt' }], nextCursor: null },
        '/api/v2/files/short/text': { data: { text: 'needle', degraded: false, truncated: true } },
      }),
      { scope: 'files' }
    )
    expect(result.stdout).toContain('needle')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/truncated|incomplete/i)
  })

  it('selects a named file before applying the file-read count limit', async () => {
    const requested: string[] = []
    const result = await runEngine('grep', ['needle'], runtimeWithFilePages(301, requested), {
      scope: 'files',
      in: 'files/f300',
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('needle')
    expect(requested.filter((path) => path !== '/api/v2/files')).toEqual([
      '/api/v2/files/f300/text',
    ])
  })

  it('reports file coverage when a broad search reaches the extraction limit', async () => {
    const requested: string[] = []
    const result = await runEngine('grep', ['needle'], runtimeWithFilePages(350, requested), {
      scope: 'files',
      count: true,
    })
    expect(requested.filter((path) => path !== '/api/v2/files')).toHaveLength(300)
    expect(result.stdout).toBe('300 (files=300)')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('300 of 350')
  })

  it('reports all matching lines when the output limit stops displaying later resources', async () => {
    const result = await runEngine(
      'grep',
      ['needle'],
      runtimeWith({
        '/api/v2/files': { data: [{ id: 'one' }, { id: 'two' }], nextCursor: null },
        '/api/v2/files/one/text': { data: { text: 'needle\nneedle', degraded: false } },
        '/api/v2/files/two/text': { data: { text: 'needle\nneedle', degraded: false } },
      }),
      { scope: 'files', limit: '1' }
    )
    expect(result.stdout).toContain('1 of 4 matching lines')
  })
})

describe('search lifecycle and coverage', () => {
  it('settles sibling reads before returning a failed search', async () => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const runtime = runtimeWith({})
    runtime.client = {
      request: async <T>(path: string): Promise<T> => {
        if (path === '/api/v2/secrets') throw new Error('Permission lookup failed')
        started.resolve()
        await release.promise
        return { data: [], nextCursor: null } as T
      },
    }
    let settled = false
    const pending = runEngine('grep', ['x'], runtime, { scope: 'secrets,credentials' }).then(
      (result) => {
        settled = true
        return result
      }
    )
    await started.promise
    try {
      await sleep(1)
      expect(settled).toBe(false)
    } finally {
      release.resolve()
    }
    expect((await pending).exitCode).toBe(1)
  })
  it('does not share in-flight credential reads across actors', async () => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const first = runtimeWith({})
    first.client = {
      request: async <T>(): Promise<T> => {
        started.resolve()
        await release.promise
        return { data: [{ id: 'alice-private', name: 'ALICE_ONLY' }], nextCursor: null } as T
      },
    }
    const second = {
      ...runtimeWith({ '/api/v2/credentials': { data: [], nextCursor: null } }),
      workspaceId: first.workspaceId,
      userId: 'bob',
    }
    const alice = runEngine('grep', ['ALICE_ONLY'], first, { scope: 'credentials' })
    await started.promise
    const bob = runEngine('grep', ['ALICE_ONLY'], second, { scope: 'credentials', count: true })
    release.resolve()
    const results = await Promise.all([alice, bob])
    expect(results[0].stdout).toContain('ALICE_ONLY')
    expect(results[1].stdout).toBe('0')
  })

  it('settles Stop while queued without starting a read after a slot opens', async () => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let active = 0
    const blockers = Array.from({ length: 8 }, () => {
      const runtime = runtimeWith({})
      runtime.client = {
        request: async <T>(): Promise<T> => {
          if (++active === 8) started.resolve()
          await release.promise
          return { data: [], nextCursor: null } as T
        },
      }
      return runEngine('grep', ['x'], runtime, { scope: 'credentials' })
    })
    await started.promise
    const controller = new AbortController()
    const request = vi.fn()
    let settled = false
    const stopped = runEngine(
      'grep',
      ['x'],
      { ...runtimeWith({}), client: { request }, signal: controller.signal },
      { scope: 'credentials' }
    ).then((result) => {
      settled = true
      return result
    })
    try {
      controller.abort(new Error('Stopped'))
      await sleep(1)
      expect(settled).toBe(true)
      expect((await stopped).exitCode).toBe(1)
      expect(request).not.toHaveBeenCalled()
    } finally {
      release.resolve()
      await Promise.all([...blockers, stopped])
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('reports a capped listing and lower-bound count', async () => {
    let calls = 0
    const runtime = runtimeWith({})
    runtime.client = {
      request: async <T>(): Promise<T> => {
        calls++
        return { data: [{ name: `KEY_${calls}` }], nextCursor: `page-${calls}` } as T
      },
    }
    const result = await runEngine('grep', ['^name: KEY_'], runtime, {
      scope: 'secrets',
      count: true,
    })
    expect(calls).toBe(50)
    expect(result.stdout).toBe('50 (secrets=50)')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('50 pages')
  })

  it('preserves a selected unreadable file as a read failure, not an unknown selector', async () => {
    const result = await runEngine(
      'grep',
      ['needle'],
      runtimeWith({
        '/api/v2/files': { data: [{ id: 'broken', name: 'broken.txt' }], nextCursor: null },
      }),
      { scope: 'files', in: 'files/broken' }
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('could not read text')
    expect(result.stderr).not.toContain('Unknown --in')
  })
})
