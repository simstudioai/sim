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
      plaidCredentialId: 'credential-1',
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
    ])
    expect(
      accounts.enabled?.(
        args({ context: { workspaceId: 'workspace-1', plaidCredentialId: undefined } })
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
        },
      })
    )
    expect(JSON.stringify(mockRequestJson.mock.calls)).not.toContain('accessToken')
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
        plaidCredentialId: 'credential-1',
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
            plaidCredentialId: 'credential-1',
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
