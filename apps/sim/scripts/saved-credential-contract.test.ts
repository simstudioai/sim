import { describe, expect, it } from 'vitest'
import type { BlockConfig } from '@/blocks/types'
import {
  hostSteeringParams,
  savedCredentialContractErrors,
} from '@/scripts/saved-credential-contract'
import type { ToolMetadata } from '@/tools/metadata'
import type { ExecutableToolConfig, OAuthConfig, ToolConfig } from '@/tools/types'

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

  it('builds a URL that validates a base URL beside a numeric id, so the id is not mistaken for the host', () => {
    const tool = requestTool({ instanceUrl: required, projectId: required }, (p) => {
      if (!/^[1-9]\d*$/.test(String(p.projectId))) throw new Error('projectId must be numeric')
      return `${new URL(String(p.instanceUrl)).origin}/rest/v1/tags?project=${p.projectId}`
    })

    expect(hostSteeringParams(tool)).toEqual({ params: ['instanceUrl'], probed: true })
  })

  it('falls back to workspace-like names when the URL never builds', () => {
    const tool = requestTool({ workspaceSlug: required, query: required }, () => {
      throw new Error('validated elsewhere')
    })

    expect(hostSteeringParams(tool)).toEqual({ params: ['workspaceSlug'], probed: false })
  })
})

/** Any real service-account provider: the fixture tool's URL builder, not the provider, is under test. */
const PROVIDER = 'jama'

/** A native token block: a service-account picker and one tool, no legacy block. */
function nativeBlock(toolId: string): BlockConfig {
  return {
    type: 'native_fixture',
    name: 'Native fixture',
    subBlocks: [
      {
        id: 'credential',
        type: 'oauth-input',
        serviceId: PROVIDER,
        credentialKind: 'service-account',
        canonicalParamId: 'oauthCredential',
        mode: 'basic',
        required: true,
      },
    ],
    tools: { access: [toolId] },
  } as BlockConfig
}

/** A tenant-host tool whose instance URL the saved credential supplies only when pinned. */
function nativeHostTool(oauth: OAuthConfig | undefined) {
  const executable = {
    ...requestTool(
      { accessToken: { type: 'string', required: true }, instanceUrl: required, id: required },
      (p) => `${new URL(String(p.instanceUrl)).origin}/items/${p.id}`
    ),
    oauth,
  }
  return {
    metadata: () => executable as ToolMetadata,
    executable: () => executable,
  }
}

const nativeOAuth: OAuthConfig = {
  required: true,
  provider: PROVIDER,
  credentialKind: 'service-account',
}

describe('savedCredentialContractErrors', () => {
  it('fails a native block whose host param the credential does not pin', () => {
    const errors = savedCredentialContractErrors(
      nativeBlock('probe_fixture'),
      [],
      nativeHostTool(nativeOAuth)
    )

    expect(errors).toEqual([expect.stringContaining('"instanceUrl" decides the host')])
  })

  it('passes a native block that pins its host param in authoritativeParams', () => {
    const errors = savedCredentialContractErrors(
      nativeBlock('probe_fixture'),
      [],
      nativeHostTool({ ...nativeOAuth, authoritativeParams: ['instanceUrl'] })
    )

    expect(errors).toEqual([])
  })

  it('fails a native block whose tool accepts any credential kind', () => {
    const errors = savedCredentialContractErrors(
      nativeBlock('probe_fixture'),
      [],
      nativeHostTool({
        required: true,
        provider: PROVIDER,
        authoritativeParams: ['instanceUrl'],
      })
    )

    expect(errors).toEqual([expect.stringContaining('accepts "any" credentials')])
  })

  it('fails a native block whose tool has no credential policy, so its token is never filled', () => {
    const errors = savedCredentialContractErrors(
      nativeBlock('probe_fixture'),
      [],
      nativeHostTool(undefined)
    )

    expect(errors).toEqual([expect.stringContaining('no credential policy')])
  })

  /** An operation tool that mints its own token from inline client credentials, at a chosen region. */
  function mintingTool(oauth: OAuthConfig) {
    const executable = {
      ...operationTool('minting_fixture', {
        accessToken: { type: 'string' },
        clientId: { type: 'string' },
        clientSecret: { type: 'string' },
        region: { type: 'string' },
      }),
      oauth,
    }
    return {
      metadata: () => executable as ToolMetadata,
      executable: () => executable,
    }
  }

  const mintingOAuth: OAuthConfig = {
    required: false,
    provider: PROVIDER,
    credentialKind: 'service-account',
    credentialParams: { accessToken: 'accessToken', region: 'domain' },
    tokenReplacesParams: ['clientId', 'clientSecret'],
    credentialSuppliedParams: ['accessToken', 'region', 'clientId', 'clientSecret'],
  }

  it('passes a tool whose inline client credentials the minted token replaces', () => {
    const errors = savedCredentialContractErrors(
      nativeBlock('minting_fixture'),
      [],
      mintingTool(mintingOAuth)
    )

    expect(errors).toEqual([])
  })

  it('fails a token-replaced secret when the credential never fills the token', () => {
    const errors = savedCredentialContractErrors(
      nativeBlock('minting_fixture'),
      [],
      mintingTool({ ...mintingOAuth, credentialParams: { region: 'domain' } })
    )

    expect(errors).toContainEqual(
      expect.stringContaining('needs credentialParams to fill "accessToken"')
    )
  })

  it('still fails a credential-supplied secret that neither the credential nor its token fills', () => {
    const errors = savedCredentialContractErrors(
      nativeBlock('minting_fixture'),
      [],
      mintingTool({ ...mintingOAuth, tokenReplacesParams: ['clientId'] })
    )

    expect(errors).toEqual([expect.stringContaining('"clientSecret" is credential-supplied')])
  })

  it('still requires the region a minting tool sends its token to be filled by the credential', () => {
    const errors = savedCredentialContractErrors(
      nativeBlock('minting_fixture'),
      [],
      mintingTool({
        ...mintingOAuth,
        credentialParams: { accessToken: 'accessToken' },
        credentialSuppliedParams: ['accessToken', 'clientId', 'clientSecret'],
      })
    )

    expect(errors).toEqual([expect.stringContaining('"region" decides the host')])
  })
})
