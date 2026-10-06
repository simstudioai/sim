import { describe, expect, it } from 'vitest'
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
