/** @vitest-environment jsdom */
import { act } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))

import { ApiClientError } from '@/lib/api/client/errors'
import {
  disconnectPersonalOrganizationAccountContract,
  listOrganizationAccountPeopleContract,
  updateOrganizationAccountsContract,
} from '@/lib/api/contracts/organization-accounts'
import {
  organizationAccountsKeys,
  useDisconnectPersonalOrganizationAccount,
  useOrganizationAccountPeople,
  useUpdateOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'
import { slackSearchKeys } from '@/hooks/queries/slack-search'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'

describe('personal account disconnect', () => {
  it.each([true, false])(
    'refreshes this organization only after success=%s, including after unmount',
    async (success) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
      mocks.request.mockReset()
      const response = Promise.withResolvers<{ success: true }>()
      mocks.request.mockReturnValue(response.promise)
      const client = new QueryClient()
      const root = createRoot(document.createElement('div'))
      let mutation: ReturnType<typeof useDisconnectPersonalOrganizationAccount>
      function Probe() {
        mutation = useDisconnectPersonalOrganizationAccount('org-1')
        return null
      }
      const own = searchSourceKeys.pages(
        { kind: 'organization', organizationId: 'org-1' },
        { mine: true, search: '' }
      )
      const catalog = searchSourceKeys.pages(
        { kind: 'organization', organizationId: 'org-1' },
        { mine: false, search: '' }
      )
      const people = organizationAccountsKeys.people('org-1')
      const other = searchSourceKeys.list({ kind: 'organization', organizationId: 'org-2' })
      for (const key of [own, catalog, people, other]) client.setQueryData(key, { existing: true })
      try {
        await act(async () =>
          root.render(
            <QueryClientProvider client={client}>
              <Probe />
            </QueryClientProvider>
          )
        )
        let pending: Promise<unknown>
        await act(async () => {
          pending = mutation.mutateAsync('own-credential')
        })
        await act(async () =>
          root.render(<QueryClientProvider client={client}>{null}</QueryClientProvider>)
        )
        await act(async () => {
          if (success) {
            response.resolve({ success: true })
            await pending
          } else {
            const rejection = expect(pending).rejects.toThrow('Try again')
            response.reject(new Error('Try again'))
            await rejection
          }
        })
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
          disconnectPersonalOrganizationAccountContract,
          { params: { credentialId: 'own-credential' } }
        )
        for (const key of [own, catalog, people])
          expect(client.getQueryState(key)?.isInvalidated).toBe(success)
        expect(client.getQueryState(other)?.isInvalidated).toBe(false)
      } finally {
        await act(async () => root.unmount())
        client.clear()
        vi.unstubAllGlobals()
      }
    }
  )
})

describe('organization account setup updates', () => {
  it.each([true, false])(
    'refreshes only this organization’s setup after the caller unmounts on success=%s',
    async (success) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
      mocks.request.mockReset()
      const response = Promise.withResolvers<object>()
      mocks.request.mockReturnValue(response.promise)
      const client = new QueryClient()
      const container = document.createElement('div')
      const root = createRoot(container)
      let mutation: ReturnType<typeof useUpdateOrganizationAccounts>
      function Probe() {
        mutation = useUpdateOrganizationAccounts()
        return null
      }
      const current = slackSearchKeys.manifest('org-1', 'Sim Search')
      const renamed = slackSearchKeys.manifest('org-1', 'Custom name')
      const other = slackSearchKeys.manifest('org-2', 'Sim Search')
      const overview = searchSourceKeys.organizationOverview('org-1')
      const otherOverview = searchSourceKeys.organizationOverview('org-2')
      for (const key of [current, renamed, other]) client.setQueryData(key, { existingApp: 'A1' })
      for (const key of [overview, otherOverview]) client.setQueryData(key, { providers: [] })
      try {
        await act(async () =>
          root.render(
            <QueryClientProvider client={client}>
              <Probe />
            </QueryClientProvider>
          )
        )
        const input = { organizationId: 'org-1', groupId: 'group-1', update: { options: [] } }
        let update: Promise<unknown>
        await act(async () => {
          update = mutation.mutateAsync(input)
        })
        await act(async () =>
          root.render(<QueryClientProvider client={client}>{null}</QueryClientProvider>)
        )
        await act(async () => {
          if (success) {
            response.resolve({})
            await update
          } else {
            const rejection = expect(update).rejects.toThrow('Source still uses')
            response.reject(new Error('Source still uses Slack accounts'))
            await rejection
          }
        })
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith(updateOrganizationAccountsContract, {
          params: { id: 'org-1', groupId: 'group-1' },
          body: { options: [] },
        })
        expect(client.getQueryState(current)?.isInvalidated).toBe(success)
        expect(client.getQueryState(renamed)?.isInvalidated).toBe(success)
        expect(client.getQueryState(other)?.isInvalidated).toBe(false)
        expect(client.getQueryState(overview)?.isInvalidated).toBe(success)
        expect(client.getQueryState(otherOverview)?.isInvalidated).toBe(false)
      } finally {
        await act(async () => root.unmount())
        client.clear()
        vi.unstubAllGlobals()
      }
    }
  )
})

describe('organization people search pagination', () => {
  let root: Root
  let container: HTMLDivElement
  let client: QueryClient
  let result: ReturnType<typeof useOrganizationAccountPeople>

  function Probe({
    search,
    organizationId,
    enabled,
    optionId,
  }: {
    search: string
    organizationId: string
    enabled: boolean
    optionId?: string
  }) {
    result = useOrganizationAccountPeople(organizationId, search, { enabled, optionId })
    return (
      <span>
        {result.status}: {result.data?.pages.length}
      </span>
    )
  }

  async function flushQueries() {
    await act(async () => {
      for (let index = 0; index < 5; index++) await sleep(1)
    })
  }

  async function render(
    search: string,
    organizationId = 'org-1',
    enabled = true,
    optionId?: string
  ) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe
            search={search}
            organizationId={organizationId}
            enabled={enabled}
            optionId={optionId}
          />
        </QueryClientProvider>
      )
    )
    await flushQueries()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.request.mockReset()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    vi.unstubAllGlobals()
  })

  it('keeps provider projection on every page and isolates another provider’s first page', async () => {
    mocks.request
      .mockResolvedValueOnce({ enrollments: [], nextCursor: 'next' })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
    await render('', 'org-1', true, 'gmail-option')
    await act(async () => {
      await result.fetchNextPage()
    })
    await flushQueries()
    expect(mocks.request).toHaveBeenNthCalledWith(
      2,
      listOrganizationAccountPeopleContract,
      expect.objectContaining({
        query: { limit: 50, cursor: 'next', search: undefined, optionId: 'gmail-option' },
      })
    )
    await render('', 'org-1', true, 'confluence-option')
    expect(mocks.request).toHaveBeenNthCalledWith(
      3,
      listOrganizationAccountPeopleContract,
      expect.objectContaining({
        query: { limit: 50, cursor: undefined, search: undefined, optionId: 'confluence-option' },
      })
    )
    expect(result.data?.pages).toHaveLength(1)
  })

  it('sends search on every bounded page and starts a new first page when it changes', async () => {
    mocks.request
      .mockResolvedValueOnce({ enrollments: [], nextCursor: 'alpha-page-2' })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
    await render(' alpha ')
    expect(mocks.request).toHaveBeenNthCalledWith(1, listOrganizationAccountPeopleContract, {
      params: { id: 'org-1' },
      query: { limit: 50, cursor: undefined, search: 'alpha' },
      signal: expect.any(AbortSignal),
    })
    await act(async () => {
      await result.fetchNextPage()
    })
    await flushQueries()
    expect(result.data?.pages).toHaveLength(2)
    expect(mocks.request).toHaveBeenNthCalledWith(2, listOrganizationAccountPeopleContract, {
      params: { id: 'org-1' },
      query: { limit: 50, cursor: 'alpha-page-2', search: 'alpha' },
      signal: expect.any(AbortSignal),
    })
    await render('beta')
    expect(mocks.request).toHaveBeenNthCalledWith(3, listOrganizationAccountPeopleContract, {
      params: { id: 'org-1' },
      query: { limit: 50, cursor: undefined, search: 'beta' },
      signal: expect.any(AbortSignal),
    })
    expect(result.data?.pages).toHaveLength(1)
  })

  it('keeps search pages scoped to the organization and omits whitespace-only search', async () => {
    mocks.request
      .mockResolvedValueOnce({ enrollments: [], nextCursor: 'org-1-next' })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
    await render('   ')
    await render('', 'org-2')
    expect(mocks.request).toHaveBeenLastCalledWith(listOrganizationAccountPeopleContract, {
      params: { id: 'org-2' },
      query: { limit: 50, cursor: undefined, search: undefined },
      signal: expect.any(AbortSignal),
    })
    expect(result.hasNextPage).toBe(false)
    expect(result.data?.pages).toHaveLength(1)
  })

  it('waits for an organization even when explicitly enabled', async () => {
    await render('', '', true)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('does not request people while disabled and stops refetching after setup is known missing', async () => {
    mocks.request.mockResolvedValue({ enrollments: [], nextCursor: null })
    await render('', 'org-1', false)
    expect(mocks.request).not.toHaveBeenCalled()

    await render('', 'org-1', true)
    expect(mocks.request).toHaveBeenCalledOnce()
    await render('', 'org-1', false)
    await act(async () => {
      await client.invalidateQueries({ queryKey: organizationAccountsKeys.people('org-1') })
    })
    await render('another search', 'org-1', false)
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it.each([400, 401, 403, 404, 409, 422])(
    'does not retry a non-retryable %s response',
    async (status) => {
      mocks.request.mockRejectedValue(
        new ApiClientError({ status, message: 'Unavailable', body: null })
      )
      await render('')
      expect(result.isError).toBe(true)
      expect(mocks.request).toHaveBeenCalledOnce()
    }
  )

  it.each([408, 429, 500])('retains one retry for a transient %s response', async (status) => {
    mocks.request.mockRejectedValue(
      new ApiClientError({ status, message: 'Try again', body: null })
    )
    await render('')
    expect(result.isError).toBe(true)
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })
})
