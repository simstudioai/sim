/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetch, mockValidateUrl } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  mockValidateUrl: vi.fn(),
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mockSecureFetch,
  validateUrlWithDNS: mockValidateUrl,
}))

import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'

const auth = {
  oauthCredential: 'service-account-id',
  instanceUrl: 'https://epm.example.com/gateway',
  accessToken: Buffer.from('operator:credential').toString('base64'),
}
const client = createOracleEpmClient(auth)
const context = { client }
beforeEach(() => {
  vi.clearAllMocks()
  mockValidateUrl.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
  mockSecureFetch.mockImplementation(async () => Response.json({ status: 0 }))
})

const credentials = vi.hoisted(() => ({ resolve: vi.fn(), bundle: vi.fn() }))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveOAuthAccountId: credentials.resolve }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: credentials.bundle,
}))

import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleEpmPlatformSelectorAttachments as attachments } from '@/lib/selectors/server/providers/oracle-epm-platform'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

type Key = keyof typeof attachments
function args(key: Key, credentialId = 'credential-1'): ExecuteServerSelectorArgs {
  return {
    selectorKey: key,
    context: {},
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: {
      suppliedId: credentialId,
      access: {
        canAccess: true,
        credentialType: 'service_account',
        resolvedCredentialId: credentialId,
      },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}
beforeEach(() => {
  credentials.resolve.mockResolvedValue({
    credentialType: 'service_account',
    providerId: 'oracle-epm-service-account',
  })
  credentials.bundle.mockResolvedValue({
    accessToken: auth.accessToken,
    instanceUrl: auth.instanceUrl,
  })
})
describe('Oracle EPM Platform credential-bound selectors', () => {
  it.each([
    ['oracle_epm_platform.files', ['Artifact Snapshot', 'inbox/data.csv']],
    ['oracle_epm_platform.snapshots', ['Artifact Snapshot']],
  ] as const)('%s projects appropriate repository items', async (key, expected) => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({
        status: 0,
        items: [
          { name: 'inbox/data.csv', type: 'EXTERNAL', size: '4', lastmodifiedtime: '1' },
          { name: 'Artifact Snapshot', type: 'LCM', size: null, lastmodifiedtime: null },
        ],
      })
    )
    const result = await attachments[key].execute(args(key))
    expect(result.kind).toBe('list')
    if (result.kind !== 'list') throw new Error('Expected list')
    expect(result.items.map((item) => item.id)).toEqual(expected)
    expect(mockSecureFetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/gateway/interop/rest/v2/files/list'
    )
  })

  it('groups reuse the tool listing contract without the contradictory type filter', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({
        status: 0,
        details: [{ groupname: 'Reviewers', description: '', type: 'EPM', identity: 'g1' }],
      })
    )
    expect(
      await attachments['oracle_epm_platform.groups'].execute(args('oracle_epm_platform.groups'))
    ).toMatchObject({
      kind: 'list',
      items: [{ id: 'Reviewers', label: 'Reviewers', meta: { detail: 'EPM' } }],
    })
    expect(mockSecureFetch.mock.calls[0][2]).toMatchObject({ method: 'POST', body: '{}' })
  })

  it('roles use names accepted by the mutation API rather than tenant-specific role IDs', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({ status: 0, details: [{ name: 'Access Control - View', id: 'HP:ROLE_X' }] })
    )
    expect(
      await attachments['oracle_epm_platform.roles'].execute(args('oracle_epm_platform.roles'))
    ).toMatchObject({
      kind: 'list',
      items: [
        {
          id: 'Access Control - View',
          label: 'Access Control - View',
          meta: { detail: 'HP:ROLE_X' },
        },
      ],
    })
  })

  it('re-binds the origin and authorization when the selected credential changes', async () => {
    credentials.bundle
      .mockResolvedValueOnce({ accessToken: auth.accessToken, instanceUrl: auth.instanceUrl })
      .mockResolvedValueOnce({
        accessToken: Buffer.from('other:credential').toString('base64'),
        instanceUrl: 'https://second.example.com',
      })
    mockSecureFetch.mockImplementation(async () => Response.json({ status: 0, details: [] }))
    const key = 'oracle_epm_platform.roles'
    await attachments[key].execute(args(key, 'credential-1'))
    await attachments[key].execute(args(key, 'credential-2'))
    expect(credentials.resolve.mock.calls.map(([id]) => id)).toEqual([
      'credential-1',
      'credential-2',
    ])
    expect(mockSecureFetch.mock.calls.map(([url]) => new URL(url).origin)).toEqual([
      'https://epm.example.com',
      'https://second.example.com',
    ])
    expect(mockSecureFetch.mock.calls[1][2].headers.Authorization).not.toBe(
      mockSecureFetch.mock.calls[0][2].headers.Authorization
    )
  })

  it('rejects a different service-account provider before resolving secrets or calling Oracle', async () => {
    credentials.resolve.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'netsuite-service-account',
    })
    await expect(
      attachments['oracle_epm_platform.roles'].execute(args('oracle_epm_platform.roles'))
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(credentials.bundle).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('returns empty lists and unknown details without fabricating options', async () => {
    mockSecureFetch.mockImplementation(async () => Response.json({ status: 0, details: [] }))
    const request = args('oracle_epm_platform.roles')
    expect(await attachments[request.selectorKey as Key].execute(request)).toEqual({
      kind: 'list',
      items: [],
    })
    expect(
      await attachments['oracle_epm_platform.roles'].execute({
        ...request,
        request: { kind: 'detail', id: 'Manual Role' },
      })
    ).toEqual({ kind: 'detail', item: null })
  })

  it('discloses capped option results and can look up a manual value outside the list cap', async () => {
    const roles = Array.from({ length: MAX_SELECTOR_OPTIONS + 1 }, (_, index) => ({
      name: `Role ${String(index).padStart(5, '0')}`,
      id: String(index),
    }))
    mockSecureFetch.mockImplementation(async () => Response.json({ status: 0, details: roles }))
    const request = args('oracle_epm_platform.roles')
    const result = await attachments['oracle_epm_platform.roles'].execute(request)
    expect(result).toMatchObject({
      kind: 'list',
      diagnostics: { truncated: { reason: 'provider-cap', limit: MAX_SELECTOR_OPTIONS } },
    })
    if (result.kind !== 'list') throw new Error('Expected list')
    expect(result.items).toHaveLength(MAX_SELECTOR_OPTIONS)
    expect(
      await attachments['oracle_epm_platform.roles'].execute({
        ...request,
        request: { kind: 'detail', id: roles.at(-1)!.name },
      })
    ).toMatchObject({
      kind: 'detail',
      item: { id: roles.at(-1)!.name },
    })
  })

  it('does not forward a malformed provider payload or its secrets', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({ status: 0, details: [{ secret: 'provider-secret' }] })
    )
    await expect(
      attachments['oracle_epm_platform.roles'].execute(args('oracle_epm_platform.roles'))
    ).rejects.toEqual(new SelectorOptionsUnavailableError())
  })
})
