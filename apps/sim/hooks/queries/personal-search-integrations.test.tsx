/** @vitest-environment jsdom */

import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('next/navigation', () => nextNavigationMock)

import { ApiClientError } from '@/lib/api/client/errors'
import { listOrganizationAccountPeopleContract } from '@/lib/api/contracts/organization-accounts'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import { useOrganizationAccountPeople } from '@/hooks/queries/organization-accounts'
import {
  useRemovePersonalSearchCredential,
  useSavePersonalSearchCredential,
} from '@/hooks/queries/personal-search-integrations'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

describe('organization accounts', () => {
  let root: Root
  let container: HTMLDivElement
  let client: QueryClient
  let result: ReturnType<typeof useOrganizationAccountPeople>
  let removal: ReturnType<typeof useRemovePersonalSearchCredential>
  let save: ReturnType<typeof useSavePersonalSearchCredential>

  function CredentialMutationProbe() {
    removal = useRemovePersonalSearchCredential()
    save = useSavePersonalSearchCredential()
    return null
  }

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
    mockRequestJson.mockReset()
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
  })

  it('keeps provider projection on every page and isolates another provider’s first page', async () => {
    mockRequestJson
      .mockResolvedValueOnce({ enrollments: [], nextCursor: 'next' })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
    await render('', 'org-1', true, 'gmail-option')
    await act(async () => {
      await result.fetchNextPage()
    })
    await flushQueries()
    expect(mockRequestJson).toHaveBeenNthCalledWith(
      2,
      listOrganizationAccountPeopleContract,
      expect.objectContaining({
        query: { limit: 50, cursor: 'next', search: undefined, optionId: 'gmail-option' },
      })
    )
    await render('', 'org-1', true, 'confluence-option')
    expect(mockRequestJson).toHaveBeenNthCalledWith(
      3,
      listOrganizationAccountPeopleContract,
      expect.objectContaining({
        query: { limit: 50, cursor: undefined, search: undefined, optionId: 'confluence-option' },
      })
    )
    expect(result.data?.pages).toHaveLength(1)
  })

  it('keeps search pages scoped to the organization and omits whitespace-only search', async () => {
    mockRequestJson
      .mockResolvedValueOnce({ enrollments: [], nextCursor: 'org-1-next' })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
    await render('   ')
    await render('', 'org-2')
    expect(mockRequestJson).toHaveBeenLastCalledWith(listOrganizationAccountPeopleContract, {
      params: { id: 'org-2' },
      query: { limit: 50, cursor: undefined, search: undefined },
      signal: expect.any(AbortSignal),
    })
    expect(result.hasNextPage).toBe(false)
    expect(result.data?.pages).toHaveLength(1)
  })

  it.each(['remove', 'reconnect'] as const)(
    'clears cached Search content after %s while preserving another organization’s results',
    async (action) => {
      const search = knowledgeKeys.search(
        resourceScopeKey({ kind: 'organization', organizationId: 'org-1' }),
        'private content'
      )
      const otherSearch = knowledgeKeys.search(
        resourceScopeKey({ kind: 'organization', organizationId: 'org-2' }),
        'private content'
      )
      const document = knowledgeKeys.document('knowledge-1', 'document-1')
      client.setQueryData(search, [{ content: 'previous credential content' }])
      client.setQueryData(otherSearch, [{ content: 'other organization content' }])
      client.setQueryData(document, { content: 'previous credential document' })
      mockRequestJson.mockResolvedValueOnce(
        action === 'remove' ? { success: true } : { credentialId: 'credential-1' }
      )

      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <CredentialMutationProbe />
          </QueryClientProvider>
        )
      )
      await act(async () => {
        const body = { organizationId: 'org-1', credentialId: 'credential-1' }
        if (action === 'remove') await removal.mutateAsync(body)
        else
          await save.mutateAsync({
            ...body,
            providerId: 'flow-service-account',
            apiToken: 'rotated-token',
            domain: 'https://api.flowengineering.com',
            providerWorkspaceId: 'workspace-1',
          })
      })

      expect(client.getQueryData(search)).toBeUndefined()
      expect(client.getQueryData(document)).toBeUndefined()
      expect(client.getQueryData(otherSearch)).toEqual([{ content: 'other organization content' }])
    }
  )

  it.each([400, 401, 403, 404, 409, 422])(
    'does not retry a non-retryable %s response',
    async (status) => {
      mockRequestJson.mockRejectedValue(
        new ApiClientError({ status, message: 'Unavailable', body: null })
      )
      await render('')
      expect(result.isError).toBe(true)
      expect(mockRequestJson).toHaveBeenCalledOnce()
    }
  )
})
