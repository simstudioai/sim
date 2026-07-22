import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect, test } from '@playwright/test'
import { E2E_MCP_TOOL, startMcpFakeServer } from '../fakes/mcp/server'
import { assertValidMcpFakeTraffic } from '../support/mcp-requests'

function loopbackUrl(advertisedUrl: string): URL {
  const url = new URL(advertisedUrl)
  url.hostname = '127.0.0.1'
  return url
}

async function connectClient(url: URL, name: string) {
  const transport = new StreamableHTTPClientTransport(url)
  const client = new Client({ name, version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)
  return { client, transport }
}

test('MCP fake maintains independent sessions and deterministic discovery', async () => {
  const fake = await startMcpFakeServer()
  const advertisedUrl = fake.baseUrl
  expect(advertisedUrl).toMatch(/^http:\/\/mcp\.e2e\.sim\.ai:\d+\/mcp$/)
  const url = loopbackUrl(advertisedUrl!)
  const first = await connectClient(url, 'foundation-mcp-client-one')
  const second = await connectClient(url, 'foundation-mcp-client-two')

  try {
    const [firstTools, secondTools] = await Promise.all([
      first.client.listTools(),
      second.client.listTools(),
    ])
    await first.client.ping()
    for (const result of [firstTools, secondTools]) {
      expect(result.tools).toHaveLength(1)
      expect(result.tools[0]).toMatchObject({
        name: E2E_MCP_TOOL.name,
        description: E2E_MCP_TOOL.description,
        inputSchema: E2E_MCP_TOOL.inputSchema,
      })
    }

    const firstSessionId = first.transport.sessionId
    const secondSessionId = second.transport.sessionId
    expect(firstSessionId).toBeTruthy()
    expect(secondSessionId).toBeTruthy()
    expect(firstSessionId).not.toBe(secondSessionId)

    await Promise.all([first.transport.terminateSession(), second.transport.terminateSession()])

    const records = fake.requestLog
    expect(
      records.filter(({ rpcMethod }) => rpcMethod === 'initialize').map(({ session }) => session)
    ).toEqual(['session-1', 'session-2'])
    expect(
      records.filter(({ rpcMethod }) => rpcMethod === 'tools/list').map(({ session }) => session)
    ).toEqual(expect.arrayContaining(['session-1', 'session-2']))
    expect(records.some(({ rpcMethod, status }) => rpcMethod === 'ping' && status === 200)).toBe(
      true
    )
    expect(records.filter(({ method, status }) => method === 'GET' && status === 405)).toHaveLength(
      2
    )
    expect(
      records.filter(({ method, status }) => method === 'DELETE' && status === 200)
    ).toHaveLength(2)
    expect(records.every(({ unexpected }) => !unexpected)).toBe(true)
    expect(JSON.stringify(records)).not.toContain(firstSessionId)
    expect(JSON.stringify(records)).not.toContain(secondSessionId)
    assertValidMcpFakeTraffic(records, true)
  } finally {
    await Promise.allSettled([first.client.close(), second.client.close()])
    await fake.stop()
  }
})

test('MCP fake bounds and safely records unsupported traffic', async () => {
  const fake = await startMcpFakeServer({ maxBodyBytes: 1024 })
  const advertisedUrl = fake.baseUrl!
  const url = loopbackUrl(advertisedUrl)
  const connection = await connectClient(url, 'foundation-mcp-malformed-client')
  const sessionId = connection.transport.sessionId!

  try {
    const commonHeaders = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    }
    const malformed = await fetch(url, {
      method: 'POST',
      headers: commonHeaders,
      body: '{not-json',
    })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32700 },
      id: null,
    })

    const unsupportedRpc = await fetch(url, {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'mcp-session-id': sessionId,
        'mcp-protocol-version': connection.transport.protocolVersion!,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'resources/list' }),
    })
    expect(unsupportedRpc.status).toBe(200)
    expect(await unsupportedRpc.json()).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32601 },
      id: 99,
    })

    const wrongContentType = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    })
    expect(wrongContentType.status).toBe(415)

    const oversized = await fetch(url, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify({ value: 'x'.repeat(2048) }),
    })
    expect(oversized.status).toBe(413)

    const unsupportedPath = await fetch(new URL('/other', url))
    expect(unsupportedPath.status).toBe(404)
    const unsupportedMethod = await fetch(url, { method: 'PUT' })
    expect(unsupportedMethod.status).toBe(405)

    const records = fake.requestLog
    expect(records.filter(({ unexpected }) => unexpected)).toHaveLength(6)
    expect(() => assertValidMcpFakeTraffic(records, false)).toThrow(
      /MCP fake received unsupported requests/
    )
    for (const record of records) {
      expect(Object.keys(record).sort()).toEqual(
        ['method', 'path', 'rpcMethod', 'sequence', 'session', 'status', 'unexpected'].filter(
          (key) => key !== 'rpcMethod' || record.rpcMethod !== undefined
        )
      )
    }
    const serialized = JSON.stringify(records)
    expect(serialized).not.toContain(sessionId)
    expect(serialized).not.toContain('not-json')
    expect(serialized).not.toContain('x'.repeat(32))
  } finally {
    await connection.client.close()
    await fake.stop()
  }
})

test('MCP lifecycle validation is conditional on the workflow marker', () => {
  expect(() => assertValidMcpFakeTraffic([], false)).not.toThrow()
  expect(() => assertValidMcpFakeTraffic([], true)).toThrow(/initialize/)
})
