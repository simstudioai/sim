/**
 * Tests for the deprecated Copilot MCP route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { GET as authServerDiscoveryGET } from '@/app/api/mcp/copilot/.well-known/oauth-authorization-server/route'
import { GET as protectedResourceDiscoveryGET } from '@/app/api/mcp/copilot/.well-known/oauth-protected-resource/route'
import { DELETE, GET, POST } from '@/app/api/mcp/copilot/route'

const URL = 'http://localhost:3000/api/mcp/copilot'

describe('Deprecated Copilot MCP route', () => {
  it('GET returns 410', async () => {
    const response = await GET(new NextRequest(URL))
    expect(response.status).toBe(410)
  })

  it('POST returns 410 with a JSON-RPC error envelope', async () => {
    const request = new NextRequest(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(410)

    const body = (await response.json()) as { jsonrpc?: string; error?: { message?: string } }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error?.message).toContain('deprecated')
  })

  it('POST still returns 410 when an x-api-key header is present', async () => {
    const request = new NextRequest(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'sk-sim-copilot-test' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(410)
  })

  it('DELETE returns 410', async () => {
    const response = await DELETE(new NextRequest(URL, { method: 'DELETE' }))
    expect(response.status).toBe(410)
  })

  it('copilot OAuth authorization-server discovery returns 410', async () => {
    const response = await authServerDiscoveryGET(
      new NextRequest(`${URL}/.well-known/oauth-authorization-server`)
    )
    expect(response.status).toBe(410)
  })

  it('copilot OAuth protected-resource discovery returns 410', async () => {
    const response = await protectedResourceDiscoveryGET(
      new NextRequest(`${URL}/.well-known/oauth-protected-resource`)
    )
    expect(response.status).toBe(410)
  })
})
