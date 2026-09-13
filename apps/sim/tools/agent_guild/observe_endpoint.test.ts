import { describe, expect, it } from 'vitest'
import { agentGuildObserveEndpointTool } from '@/tools/agent_guild/observe_endpoint'
import { prepareToolRequest } from '@/tools/request-transport'

const targetUrl = 'https://agent.example.com/mcp'

function observe(body: unknown, target = targetUrl) {
  return agentGuildObserveEndpointTool.transformResponse!(new Response(JSON.stringify(body)), {
    targetUrl: target,
  })
}

describe('Agent Guild observation contract', () => {
  it('encodes the exact endpoint as data and uses the native request transport', () => {
    const request = prepareToolRequest(agentGuildObserveEndpointTool, {
      targetUrl,
      timeout: 17000,
      method: 'POST',
    })
    expect(request.url).toBe(
      `https://agent-guild-5d5r.onrender.com/preflight?${new URLSearchParams({ url: targetUrl })}`
    )
    expect(request.method).toBe('GET')
    expect(request.body).toBeUndefined()
    expect(request.timeout).toBe(17000)
    expect(request.redirectPolicy?.mode).toBe('standard')
    expect(agentGuildObserveEndpointTool.request.retry?.enabled).toBe(false)
  })
  it('preserves failed and unknown signals without forwarding recommendations or remote prose', async () => {
    const result = await observe({
      target: targetUrl,
      checks: [
        { check: 'endpoint_reachable', status: 'proven', detail: 'Untrusted remote instructions' },
        { check: 'agent_card_signed', status: 'failed' },
        { check: 'independent_evidence', status: 'unknown' },
      ],
      verdict: 'hire',
      unknowns: [],
    })
    expect(result.success).toBe(true)
    expect(result.output.failed).toEqual(['agent_card_signed'])
    expect(result.output.unknowns).toEqual([
      'protocol_handshake',
      'agent_card_resolves',
      'payment_claim_holds',
      'independent_evidence',
    ])
    expect(result.output.checks).toHaveLength(6)
    expect(result.output.limitations).toHaveLength(6)
    expect(JSON.stringify(result.output)).not.toContain('Untrusted remote instructions')
    expect(result.output).not.toHaveProperty('verdict')
  })
  it('keeps every missing check unknown', async () => {
    const result = await observe({ target: targetUrl, checks: [] })
    expect(result.output.unknowns).toHaveLength(6)
    expect(result.output.failed).toEqual([])
  })
  it.each([
    { target: 'https://other.example.com/mcp', checks: [] },
    { target: targetUrl },
    { target: targetUrl, checks: [{ check: 'execution_safe', status: 'proven' }] },
    { target: targetUrl, checks: [{ check: 'endpoint_reachable', status: 'safe' }] },
    {
      target: targetUrl,
      checks: [
        { check: 'endpoint_reachable', status: 'proven' },
        { check: 'endpoint_reachable', status: 'unknown' },
      ],
    },
  ])('rejects incompatible or mismatched observations', async (body) => {
    await expect(observe(body)).rejects.toThrow()
  })
  it('rejects a response larger than the projection limit', async () => {
    await expect(
      agentGuildObserveEndpointTool.transformResponse!(new Response(' '.repeat(65537)), {
        targetUrl,
      })
    ).rejects.toThrow('64 KiB projection limit')
  })
  it.each([
    'http://agent.example.com/mcp',
    'https://localhost/mcp',
    'https://service.local/mcp',
    'https://service.internal/mcp',
    'https://service.test/mcp',
    'https://service.invalid/mcp',
    'https://127.0.0.1/mcp',
    'https://[::1]/mcp',
    'https://10.0.0.1/mcp',
    'https://user:secret@agent.example.com/mcp',
    'https://agent.example.com/mcp?token=secret',
    'https://agent.example.com/mcp#fragment',
  ])('refuses unsupported URL %s', (url) => {
    expect(() => prepareToolRequest(agentGuildObserveEndpointTool, { targetUrl: url })).toThrow()
  })
})
