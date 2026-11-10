/** @vitest-environment jsdom */

import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('next/navigation', () => nextNavigationMock)

import { resourceScopeKey } from '@/lib/core/resource-scope'
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
  let removal: ReturnType<typeof useRemovePersonalSearchCredential>
  let save: ReturnType<typeof useSavePersonalSearchCredential>

  function CredentialMutationProbe() {
    removal = useRemovePersonalSearchCredential()
    save = useSavePersonalSearchCredential()
    return null
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
})
