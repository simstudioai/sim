/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ bundle: vi.fn(), fetch: vi.fn(), dns: vi.fn() }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.bundle,
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))

import {
  buildSelectorContextFromValues,
  getSelectorContextSubBlocks,
} from '@/lib/selectors/context'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleEpmEdmSelectorAttachments } from '@/lib/selectors/server/providers/oracle-epm-enterprise-data-management'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import { OracleEpmEnterpriseDataManagementBlock } from '@/blocks/blocks/oracle_epm_enterprise_data_management'

const id = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
type Key = keyof typeof oracleEpmEdmSelectorAttachments
function args(selectorKey: Key): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: {},
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: id },
    workspaceId: id,
    principal: { kind: 'session', userId: 'user', sessionId: 'session' },
    requesterUserId: 'user',
    credential: {
      suppliedId: 'credential',
      providerId: 'oracle-epm-service-account',
      access: {
        ok: true,
        credentialType: 'service_account',
        resolvedCredentialId: 'credential',
        credentialOwnerUserId: 'user',
      },
    },
    protectedValues: createSelectorProtectedValues(),
    references: new Map(),
  }
}
describe('EDM credential-bound server selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.bundle.mockResolvedValue({
      accessToken: 'dTpw',
      instanceUrl: 'https://edm.example.com/gateway',
    })
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
  })
  it('binds discovery to the authorized credential destination, not raw selector context', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ items: [{ id, name: 'Planning' }] }))
    const input = args('oracleEpmEdm.applications')
    input.context = { domain: 'other.example.com' }
    const result = await oracleEpmEdmSelectorAttachments[input.selectorKey as Key].execute(input)
    expect(result).toMatchObject({ kind: 'list', items: [{ id, label: 'Planning' }] })
    expect(new URL(mocks.fetch.mock.calls[0][0]).origin).toBe('https://edm.example.com')
    expect(mocks.bundle).toHaveBeenCalledWith(
      expect.objectContaining({ credential: input.credential })
    )
  })
  it.each([
    undefined,
    {
      suppliedId: 'credential',
      providerId: 'netsuite-service-account',
      access: {
        ok: true,
        credentialType: 'service_account' as const,
        resolvedCredentialId: 'credential',
      },
    },
  ])('rejects missing or wrong-provider credential authority', async (credential) => {
    const input = { ...args('oracleEpmEdm.applications'), credential }
    await expect(
      oracleEpmEdmSelectorAttachments['oracleEpmEdm.applications'].execute(input)
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mocks.bundle).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it.each([
    'oracleEpmEdm.dimensions',
    'oracleEpmEdm.viewpoints',
    'oracleEpmEdm.nodeTypes',
  ] as const)('requires active dependencies for %s before provider discovery', async (key) => {
    await expect(oracleEpmEdmSelectorAttachments[key].execute(args(key))).rejects.toBeInstanceOf(
      SelectorContextUnavailableError
    )
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('derives dimensions from the selected application', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({
        items: [{ id, name: 'Planning', dimensions: [{ id: other, name: 'Account' }] }],
      })
    )
    const input = { ...args('oracleEpmEdm.dimensions'), context: { applicationId: id } }
    expect(
      await oracleEpmEdmSelectorAttachments['oracleEpmEdm.dimensions'].execute(input)
    ).toMatchObject({ items: [{ id: other, label: 'Account' }] })
    expect(new URL(mocks.fetch.mock.calls[0][0]).searchParams.get('q')).toBe(`id::${id}`)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('derives node-type references from the selected viewpoint assignment', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({
        items: [
          {
            id,
            name: 'Accounts',
            nodeTypeAssignments: [{ nodeTypeLink: { id: other, name: 'Account Type' } }],
          },
        ],
      })
    )
    const input = { ...args('oracleEpmEdm.nodeTypes'), context: { viewId: other, viewpointId: id } }
    expect(
      await oracleEpmEdmSelectorAttachments['oracleEpmEdm.nodeTypes'].execute(input)
    ).toMatchObject({ items: [{ id: other, label: 'Account Type' }] })
    expect(new URL(mocks.fetch.mock.calls[0][0]).pathname).toBe(
      `/gateway/epm/rest/v1/views/${other}/viewpoints`
    )
  })
  it('uses a 30-day request window and safe request labels', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ items: [{ id, title: 'Approval', requestNumber: 12, status: 'DRAFT' }] })
    )
    expect(
      await oracleEpmEdmSelectorAttachments['oracleEpmEdm.requests'].execute(
        args('oracleEpmEdm.requests')
      )
    ).toMatchObject({
      items: [{ id, label: '12 — Approval', meta: { status: 'DRAFT', requestNumber: 12 } }],
    })
    expect(new URL(mocks.fetch.mock.calls[0][0]).searchParams.get('lastDays')).toBe('30')
  })
  it('keeps local search bounded and reports truncation rather than claiming provider search', async () => {
    const items = Array.from({ length: 501 }, (_, n) => ({
      id: `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
      name: `Application ${n}`,
    }))
    mocks.fetch.mockResolvedValue(Response.json({ items }))
    const input = {
      ...args('oracleEpmEdm.applications'),
      request: { kind: 'list' as const, search: 'Application 500' },
    }
    expect(
      await oracleEpmEdmSelectorAttachments['oracleEpmEdm.applications'].execute(input)
    ).toMatchObject({
      items: [],
      diagnostics: { truncated: { reason: 'provider-cap', limit: 500 } },
    })
    expect(new URL(mocks.fetch.mock.calls[0][0]).search).toBe('')
  })
  it('resolves selected details only from the bounded discovered set', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ items: [{ id, name: 'Planning' }] }))
    const input = {
      ...args('oracleEpmEdm.applications'),
      request: { kind: 'detail' as const, id: other },
    }
    expect(
      await oracleEpmEdmSelectorAttachments['oracleEpmEdm.applications'].execute(input)
    ).toEqual({ kind: 'detail', item: null })
  })
  it.each([401, 403, 429, 500])(
    'returns safe selector errors for provider status %s',
    async (status) => {
      mocks.fetch.mockResolvedValue(new Response('provider-secret-canary', { status }))
      const expected =
        status === 401 || status === 403
          ? new SelectorConnectionUnavailableError(status)
          : new SelectorOptionsUnavailableError(status === 429 ? 429 : 502)
      await expect(
        oracleEpmEdmSelectorAttachments['oracleEpmEdm.applications'].execute(
          args('oracleEpmEdm.applications')
        )
      ).rejects.toEqual(expected)
    }
  )
  it('uses active advanced canonical dependencies and excludes unrelated stale fields', () => {
    const values = {
      operation: 'oracle_epm_edm_list_node_types',
      credential: 'stale-credential',
      manualCredential: 'active-credential',
      viewSelector: id,
      viewManual: other,
      viewpointSelector: id,
      viewpointManual: other,
      applicationManual: id,
    }
    const configs = getSelectorContextSubBlocks(
      OracleEpmEnterpriseDataManagementBlock.subBlocks,
      values
    )
    const result = buildSelectorContextFromValues({
      selectorKey: 'oracleEpmEdm.nodeTypes',
      contextConfigs: configs,
      values,
      dependsOn: ['credential', 'viewId', 'viewpointId'],
      canonicalModes: { oauthCredential: 'advanced', viewId: 'advanced', viewpointId: 'advanced' },
    })
    expect(result).toEqual({
      oauthCredential: 'active-credential',
      viewId: other,
      viewpointId: other,
    })
  })
})
