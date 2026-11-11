import { describe, expect, it } from 'vitest'
import { hostSteeringParams } from '@/scripts/saved-credential-contract'
import type { ExecutableToolConfig, ToolConfig } from '@/tools/types'

const required = { type: 'string', required: true }
const optional = { type: 'string', required: false }

/** A request tool with the given params and URL builder. */
function requestTool(
  params: Record<string, { type: string; required?: boolean }>,
  url: (params: Record<string, unknown>) => string
): ToolConfig {
  return {
    id: 'probe_fixture',
    name: 'Probe fixture',
    description: 'Fixture for the host-steering probe',
    version: '1.0.0',
    params: Object.fromEntries(
      Object.entries(params).map(([name, param]) => [
        name,
        { ...param, required: param.required ?? false, visibility: 'user-only' },
      ])
    ),
    request: { url, method: 'GET', headers: () => ({}) },
  } as ToolConfig
}

/** An operation-backed tool: its server handler, not a URL builder, picks the destination. */
function operationTool(id: string, params: Record<string, { type: string }>): ExecutableToolConfig {
  return {
    id,
    name: 'Operation fixture',
    description: 'Fixture for an operation-backed tool',
    version: '1.0.0',
    params: Object.fromEntries(
      Object.entries(params).map(([name, param]) => [
        name,
        { ...param, required: false, visibility: 'user-only' },
      ])
    ),
    operation: { input: (values: Record<string, unknown>) => values },
  } as ExecutableToolConfig
}

describe('hostSteeringParams', () => {
  it('treats a destination-named param of an operation-backed tool as steering', () => {
    const tool = operationTool('probe_operation_fixture', {
      serverUrl: optional,
      query: optional,
    })

    expect(hostSteeringParams(tool)).toEqual({ params: ['serverUrl'], probed: false })
  })

  it('leaves a known payload param of an operation-backed tool unpinned', () => {
    const tool = operationTool('browser_use_run_task', { startUrl: optional, task: optional })

    expect(hostSteeringParams(tool).params).toEqual([])
  })

  it('finds an unvalidated host param that becomes the request origin', () => {
    const tool = requestTool(
      { apiKey: required, indexHost: required, id: required },
      (p: Record<string, unknown>) => `https://${p.indexHost}/vectors/${p.id}`
    )

    expect(hostSteeringParams(tool)).toEqual({ params: ['indexHost'], probed: true })
  })

  it('finds a param holding a whole base URL', () => {
    const tool = requestTool(
      { baseUrl: optional, id: required },
      (p: Record<string, unknown>) => `${p.baseUrl ?? 'https://api.example.com'}/items/${p.id}`
    )

    expect(hostSteeringParams(tool).params).toEqual(['baseUrl'])
  })

  it('ignores params that only reach the path or query', () => {
    const tool = requestTool(
      { domain: required, companyId: required },
      (p: Record<string, unknown>) =>
        `https://api.example.com/companies/${p.companyId}?domain=${encodeURIComponent(String(p.domain))}`
    )

    expect(hostSteeringParams(tool)).toEqual({ params: [], probed: true })
  })

  it('falls back to destination-like names when no placeholder builds the URL', () => {
    const tool = requestTool({ serverUrl: required, query: required }, () => {
      throw new Error('validated elsewhere')
    })

    expect(hostSteeringParams(tool)).toEqual({ params: ['serverUrl'], probed: false })
  })

  it('defeats a host suffix check that does not parse the host', () => {
    const tool = requestTool(
      { indexHost: optional, id: required },
      (p: Record<string, unknown>) => {
        const host = String(p.indexHost ?? 'default.svc.pinecone.io')
        if (!host.endsWith('.pinecone.io')) throw new Error('not a Pinecone host')
        return `https://${host}/vectors/${p.id}`
      }
    )

    expect(hostSteeringParams(tool).params).toEqual(['indexHost'])
  })

  it('finds a host behind an optional switch', () => {
    const tool = requestTool(
      { useCustom: { type: 'boolean' }, customUrl: optional, id: required },
      (p: Record<string, unknown>) =>
        `${p.useCustom ? String(p.customUrl) : 'https://api.example.com'}/items/${p.id}`
    )

    expect(hostSteeringParams(tool).params).toEqual(['customUrl'])
  })

  it('finds a host validated against a vendor allowlist that still picks the tenant', () => {
    const tool = requestTool({ host: required, id: required }, (p) => {
      const host = String(p.host)
      if (!/^[a-z0-9-]+\.cloud\.databricks\.com$/.test(host)) throw new Error('not allowlisted')
      return `https://${host}/api/2.0/jobs/${p.id}`
    })

    expect(hostSteeringParams(tool).params).toEqual(['host'])
  })

  it('finds a numeric tenant id that picks the vendor subdomain', () => {
    const tool = requestTool({ accountId: required, id: required }, (p) => {
      const account = String(p.accountId)
      if (!/^\d+$/.test(account)) throw new Error('account ids are numeric')
      return `https://${account}.api.example.com/items/${p.id}`
    })

    expect(hostSteeringParams(tool).params).toEqual(['accountId'])
  })

  it('falls back to workspace-like names when the URL never builds', () => {
    const tool = requestTool({ workspaceSlug: required, query: required }, () => {
      throw new Error('validated elsewhere')
    })

    expect(hostSteeringParams(tool)).toEqual({ params: ['workspaceSlug'], probed: false })
  })
})
