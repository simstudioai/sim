/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({ mockRequestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

import { getSelectorDefinition } from '@/hooks/selectors/registry'
import type { SelectorQueryArgs } from '@/hooks/selectors/types'

const accounts = getSelectorDefinition('plaid.accounts')
const institutions = getSelectorDefinition('plaid.institutions')

function args(overrides: Partial<SelectorQueryArgs> = {}): SelectorQueryArgs {
  return {
    key: 'plaid.accounts',
    context: {
      workspaceId: 'workspace-1',
      oauthCredential: 'credential-1',
      operation: 'get_accounts',
    },
    ...overrides,
  }
}

describe('Plaid selectors', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keys and enables account options by workspace and opaque credential ID', () => {
    expect(accounts.enabled?.(args())).toBe(true)
    expect(accounts.getQueryKey(args())).toEqual([
      'selectors',
      'plaid.accounts',
      'workspace-1',
      'credential-1',
      'all',
    ])
    expect(
      accounts.enabled?.(
        args({ context: { workspaceId: 'workspace-1', oauthCredential: undefined } })
      )
    ).toBe(false)
  })

  it('requests account options without exposing any Plaid token', async () => {
    mockRequestJson.mockResolvedValue({ options: [{ id: 'acc-1', label: 'Checking •••0000' }] })

    await expect(accounts.fetchList?.(args())).resolves.toEqual([
      { id: 'acc-1', label: 'Checking •••0000' },
    ])
    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/tools/plaid/options' }),
      expect.objectContaining({
        body: {
          kind: 'accounts',
          workspaceId: 'workspace-1',
          credentialId: 'credential-1',
          eligibility: 'all',
        },
      })
    )
    expect(JSON.stringify(mockRequestJson.mock.calls)).not.toContain('accessToken')
  })

  it.each([
    ['get_auth', 'auth'],
    ['sync_transactions', 'transactions'],
  ] as const)('scopes %s account options to %s eligibility', async (operation, eligibility) => {
    mockRequestJson.mockResolvedValue({ options: [] })
    const scoped = args({
      context: { workspaceId: 'workspace-1', oauthCredential: 'credential-1', operation },
    })

    expect(accounts.getQueryKey(scoped)).toContain(eligibility)
    await accounts.fetchList?.(scoped)
    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: expect.objectContaining({ eligibility }) })
    )
  })

  it('hydrates only an eligible saved account for the current operation', async () => {
    const authArgs = args({
      context: {
        workspaceId: 'workspace-1',
        oauthCredential: 'credential-1',
        operation: 'get_auth',
      },
      detailId: 'acc-checking',
    })
    mockRequestJson.mockResolvedValue({
      options: [{ id: 'acc-checking', label: 'Checking ••••0000' }],
    })

    await expect(accounts.fetchById?.(authArgs)).resolves.toEqual({
      id: 'acc-checking',
      label: 'Checking ••••0000',
    })
    await expect(
      accounts.fetchById?.({ ...authArgs, detailId: 'acc-ineligible' })
    ).resolves.toBeNull()
    expect(mockRequestJson).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ body: expect.objectContaining({ eligibility: 'auth' }) })
    )
  })

  it('uses search for institution lists and get-by-id for selected-value hydration', async () => {
    mockRequestJson
      .mockResolvedValueOnce({ options: [{ id: 'ins-1', label: 'Bank' }] })
      .mockResolvedValueOnce({ options: [{ id: 'ins-1', label: 'Bank' }] })

    await institutions.fetchList?.(
      args({ key: 'plaid.institutions', search: ' bank ', detailId: undefined })
    )
    await expect(
      institutions.fetchById?.(
        args({ key: 'plaid.institutions', detailId: ' ins-1 ', search: undefined })
      )
    ).resolves.toEqual({ id: 'ins-1', label: 'Bank' })

    expect(mockRequestJson.mock.calls[0]?.[1]).toMatchObject({
      body: {
        kind: 'institution_search',
        query: 'bank',
        country_codes: ['US'],
      },
    })
    expect(mockRequestJson.mock.calls[1]?.[1]).toMatchObject({
      body: {
        kind: 'institution_detail',
        institution_id: 'ins-1',
        country_codes: ['US'],
      },
    })
  })

  it('normalizes selected countries into requests and isolates them in the query key', async () => {
    const countryArgs = args({
      key: 'plaid.institutions',
      search: 'bank',
      context: {
        workspaceId: 'workspace-1',
        oauthCredential: 'credential-1',
        countryCodes: ' ca, gb ',
      },
    })
    mockRequestJson.mockResolvedValue({ options: [] })

    expect(institutions.getQueryKey(countryArgs)).toContain('CA,GB')
    await institutions.fetchList?.(countryArgs)
    await institutions.fetchById?.({ ...countryArgs, search: undefined, detailId: 'ins-1' })
    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: expect.objectContaining({ country_codes: ['CA', 'GB'] }) })
    )
    expect(mockRequestJson).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.objectContaining({
          kind: 'institution_detail',
          institution_id: 'ins-1',
          country_codes: ['CA', 'GB'],
        }),
      })
    )
  })

  it('defaults countries to US and rejects malformed country codes', async () => {
    expect(institutions.getQueryKey(args({ key: 'plaid.institutions', search: 'bank' }))).toContain(
      'US'
    )
    await expect(
      institutions.fetchList?.(
        args({
          key: 'plaid.institutions',
          search: 'bank',
          context: {
            workspaceId: 'workspace-1',
            oauthCredential: 'credential-1',
            countryCodes: 'ZZ',
          },
        })
      )
    ).rejects.toThrow('countryCodes contains unsupported Plaid country code: ZZ')
  })

  it('does not issue an unbounded institution search', async () => {
    await expect(
      institutions.fetchList?.(args({ key: 'plaid.institutions', search: '   ' }))
    ).resolves.toEqual([])
    expect(mockRequestJson).not.toHaveBeenCalled()
  })
})
