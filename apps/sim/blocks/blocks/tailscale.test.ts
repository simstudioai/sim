/**
 * Agent tool calls pass the operation only in context and supply arguments under the tool's
 * param names, so the mapper must keep them rather than overwrite them from block-only fields.
 */
import { describe, expect, it } from 'vitest'
import { TailscaleBlock } from '@/blocks/blocks/tailscale'
import { tailscaleCreateAuthKeyTool } from '@/tools/tailscale/create_auth_key'
import { tailscaleListUsersTool } from '@/tools/tailscale/list_users'
import { tailscaleSetDnsNameserversTool } from '@/tools/tailscale/set_dns_nameservers'
import type { ToolConfig } from '@/tools/types'

const STORED = { apiKey: 'tskey-api-test', tailnet: '-' }

function agentParams(operation: string, args: Record<string, unknown>): Record<string, unknown> {
  const inputs = { ...STORED, ...args }
  const mapped = TailscaleBlock.tools.config?.params?.(inputs, { operation }) ?? {}
  return { ...inputs, ...mapped }
}

function requestBody(tool: ToolConfig, params: Record<string, unknown>) {
  const body = tool.request.body
  if (typeof body !== 'function') throw new Error(`${tool.id} has no request body`)
  return body(params)
}

function requestUrl(tool: ToolConfig, params: Record<string, unknown>) {
  const url = tool.request.url
  return typeof url === 'function' ? url(params) : url
}

describe('Tailscale block agent tool calls', () => {
  it('sends the model description and expiry when creating an auth key', () => {
    const params = agentParams('create_auth_key', {
      description: 'ci runner',
      expirySeconds: 3600,
    })
    expect(requestBody(tailscaleCreateAuthKeyTool, params)).toMatchObject({
      description: 'ci runner',
      expirySeconds: 3600,
    })
  })

  it('sends the model nameservers when setting DNS nameservers', () => {
    const params = agentParams('set_dns_nameservers', { dns: '8.8.8.8, 1.1.1.1' })
    expect(requestBody(tailscaleSetDnsNameserversTool, params)).toEqual({
      dns: ['8.8.8.8', '1.1.1.1'],
    })
  })

  it('keeps the model role filter when listing users', () => {
    const params = agentParams('list_users', { role: 'admin' })
    expect(requestUrl(tailscaleListUsersTool, params)).toContain('role=admin')
  })
})
