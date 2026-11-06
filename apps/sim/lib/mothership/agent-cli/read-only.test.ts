import { createEmbeddedClient } from 'sim/embed'
import { describe, expect, it } from 'vitest'
import { runEngine } from '@/lib/mothership/agent-cli/engines'
import { isReadOnlyCliRequest, readOnlyCliTransport } from '@/lib/mothership/agent-cli/read-only'

describe('benchmark reference workspace inspection', () => {
  it('removes credential bindings from graph reads while retaining workspace mappings and code', async () => {
    const graph = {
      blocks: {
        step: {
          id: 'step',
          type: 'function',
          name: 'Map intake',
          enabled: true,
          position: { x: 0, y: 0 },
          outputs: {},
          subBlocks: {
            oauthCredential: {
              id: 'oauthCredential',
              type: 'oauth-input',
              value: 'private-credential-id',
            },
            tableId: { id: 'tableId', type: 'input', value: 'escalation-table' },
            code: { id: 'code', type: 'code', value: 'return { owner: "Support" }' },
          },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
    }
    const transport = readOnlyCliTransport(async () => Response.json({ data: graph }))
    const response = await transport('https://sim.test/api/v2/workflows/workflow/state')
    const body = await response.text()
    expect(body).not.toContain('private-credential-id')
    expect(body).toContain('escalation-table')
    expect(body).toContain('Support')
  })
  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'refuses %s mutations even when the selected user could perform them',
    async (method) => {
      let dispatched = false
      const transport = readOnlyCliTransport(async () => {
        dispatched = true
        return Response.json({ success: true })
      })
      const result = await transport('https://sim.test/api/v2/workflows/workflow', { method })
      expect(result.status).toBe(403)
      expect(dispatched).toBe(false)
    }
  )

  it.each(['/api/v2/secrets/name'])(
    'refuses credential values from %s before contacting the source',
    async (path) => {
      let dispatched = false
      const transport = readOnlyCliTransport(async () => {
        dispatched = true
        return Response.json({ data: 'sensitive fixture' })
      })
      expect((await transport(`https://sim.test${path}`)).status).toBe(403)
      expect(dispatched).toBe(false)
    }
  )

  it('preserves secret metadata and pagination without returning even visible values', async () => {
    const metadata = {
      name: 'EXAMPLE_REFERENCE',
      scope: 'workspace',
      description: null,
      unredacted: true,
      role: 'admin',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const transport = readOnlyCliTransport(async () =>
      Response.json({
        data: [{ ...metadata, value: 'private-fixture-value' }],
        nextCursor: 'next-page',
      })
    )
    const response = await transport('https://sim.test/api/v2/secrets?cursor=first-page')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [metadata], nextCursor: 'next-page' })
  })

  it('lets the real grep engine search paginated secret names through benchmark transport', async () => {
    const transport = readOnlyCliTransport(async (input) => {
      const last = new URL(new Request(input).url).searchParams.get('cursor') === 'next-page'
      return Response.json({
        data: [
          {
            name: last ? 'EXAMPLE_SECOND' : 'EXAMPLE_FIRST',
            scope: 'workspace',
            description: null,
            unredacted: true,
            role: 'admin',
            value: 'private-fixture-value',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nextCursor: last ? null : 'next-page',
      })
    })
    const result = await runEngine(
      'grep',
      ['EXAMPLE_'],
      {
        userId: 'user-1',
        workspaceId: 'workspace',
        client: createEmbeddedClient({
          endpoint: 'https://sim.test',
          apiKey: 'fixture',
          workspaceId: 'workspace',
          transport,
        }),
      },
      { scope: 'secrets' }
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('EXAMPLE_FIRST')
    expect(result.stdout).toContain('EXAMPLE_SECOND')
    expect(result.stdout).not.toContain('private-fixture-value')
  })

  it('retains paginated reads and table queries without allowing lookalike mutation paths', async () => {
    const transport = readOnlyCliTransport(async () => Response.json({ data: 'authorized result' }))
    for (const path of ['/api/v2/workflows?cursor=next', '/api/v2/tables/table']) {
      expect(await (await transport(`https://sim.test${path}`)).json()).toEqual({
        data: 'authorized result',
      })
    }
    for (const path of ['/api/v2/tables/table/query', '/api/v2/tables/table/query/count']) {
      expect((await transport(`https://sim.test${path}`, { method: 'POST' })).status).toBe(200)
    }
    expect(
      (await transport('https://sim.test/api/v2/workflows/query', { method: 'POST' })).status
    ).toBe(403)
    expect(
      (await transport('https://sim.test/api/v2/tables/table/query/restore', { method: 'POST' }))
        .status
    ).toBe(403)
  })

  it('denies services, scratch writes and unknown engines before any side effects', () => {
    expect(
      isReadOnlyCliRequest({ invocation: { kind: 'service', name: 'settings', input: {} } })
    ).toBe(false)
    expect(
      isReadOnlyCliRequest({
        invocation: { kind: 'stdout', stdout: 'data' },
        sink: { kind: 'sandbox-file', path: 'file' },
      })
    ).toBe(false)
    expect(
      isReadOnlyCliRequest({
        invocation: { kind: 'augmentation', name: 'new engine', positionals: [], flags: {} },
      })
    ).toBe(false)
    for (const name of ['workflows deps', 'workflows lint', 'workflows api']) {
      expect(
        isReadOnlyCliRequest({
          invocation: { kind: 'augmentation', name, positionals: ['workflow'], flags: {} },
        })
      ).toBe(true)
    }
    expect(isReadOnlyCliRequest({ invocation: { kind: 'cli', argv: ['workflows', 'list'] } })).toBe(
      true
    )
  })
})
