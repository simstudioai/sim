/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { plaidSelectors } from '@/hooks/selectors/providers/plaid/selectors'
import type { SelectorQueryArgs } from '@/hooks/selectors/types'

const ACCOUNT_ARGS: SelectorQueryArgs = {
  key: 'plaid.accounts.auth',
  context: {
    workspaceId: 'workspace-1',
    oauthCredential: 'credential-record-1',
  },
}

function installFetch(body: unknown) {
  const fetchMock = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
  )
  vi.stubGlobal('fetch', Object.assign(fetchMock, { preconnect: vi.fn() }))
  return fetchMock
}

beforeEach(() => vi.clearAllMocks())

describe('Plaid selector transport', () => {
  it('validates options through the route contract and forwards cancellation', async () => {
    const fetchMock = installFetch({
      options: [{ id: 'account-1', label: 'Checking •••0000' }],
    })
    const controller = new AbortController()

    await expect(
      plaidSelectors['plaid.accounts.auth'].fetchList?.({
        ...ACCOUNT_ARGS,
        signal: controller.signal,
      })
    ).resolves.toEqual([{ id: 'account-1', label: 'Checking •••0000' }])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/tools/plaid/options')
    expect(init?.method).toBe('POST')
    expect(init?.signal).toBe(controller.signal)
    expect(JSON.parse(String(init?.body))).toEqual({
      kind: 'accounts',
      workspaceId: 'workspace-1',
      credentialId: 'credential-record-1',
      eligibility: 'auth',
    })
  })

  it('rejects malformed successful option payloads', async () => {
    installFetch({ options: [{ id: 'account-1' }] })

    await expect(plaidSelectors['plaid.accounts.auth'].fetchList?.(ACCOUNT_ARGS)).rejects.toThrow(
      /Response failed contract validation.*options\.0\.label/
    )
  })
})
