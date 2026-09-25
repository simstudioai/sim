/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteSelectorRequest, mockRequestJson } = vi.hoisted(() => ({
  mockExecuteSelectorRequest: vi.fn(),
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/selectors/client/execute-selector', () => ({
  executeSelectorRequest: mockExecuteSelectorRequest,
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

import { useSelectorOptionDetail, useSelectorOptions } from '@/hooks/queries/selectors'

interface HookHarness<T> {
  getResult: () => T
  queryClient: QueryClient
  rerender: (nextHook?: () => T) => void
  unmount: () => void
}

const mountedRoots = new Set<Root>()

function renderHookWithClient<T>(
  initialHook: () => T,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
): HookHarness<T> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.add(root)
  let hook = initialHook
  let result: T | undefined

  function Probe() {
    result = hook()
    return null
  }

  const render = () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    )
  }

  act(render)

  return {
    getResult: () => {
      if (result === undefined) throw new Error('Hook result is not ready')
      return result
    },
    queryClient,
    rerender: (nextHook) => {
      if (nextHook) hook = nextHook
      act(render)
    },
    unmount: () => {
      if (!mountedRoots.delete(root)) return
      act(() => root.unmount())
      void queryClient.cancelQueries()
      container.remove()
    },
  }
}

async function waitFor(assertion: () => void, timeout = 2_000) {
  await act(async () => {
    await vi.waitFor(assertion, { interval: 1, timeout })
  })
}

function serializedKeys(queryClient: QueryClient): string {
  return JSON.stringify(
    queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey)
  )
}

afterEach(() => {
  act(() => {
    for (const root of mountedRoots) root.unmount()
  })
  mountedRoots.clear()
  document.body.replaceChildren()
})

describe('generic selector queries', () => {
  it('uses the dedicated personal setup contract and isolates it from ordinary browsing', async () => {
    const personalItems = [{ id: 'PERSONAL', label: 'Personal project' }]
    mockRequestJson.mockResolvedValue({
      success: true,
      data: { kind: 'list', items: personalItems },
    })
    mockExecuteSelectorRequest.mockResolvedValue({
      kind: 'list',
      items: [{ id: 'ADMIN', label: 'Admin project' }],
    })
    const hook = renderHookWithClient(() =>
      useSelectorOptions('jira.projectKeys', {
        context: { oauthCredential: 'credential-1', domain: 'example.atlassian.net' },
        scope: { kind: 'organization', organizationId: 'org-1' },
        surface: { kind: 'personal-search-setup', organizationId: 'org-1', connectorType: 'jira' },
        surfaceId: 'projects',
      })
    )
    await waitFor(() => expect(hook.getResult().data).toEqual(personalItems))
    expect(mockExecuteSelectorRequest).not.toHaveBeenCalled()
    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/knowledge/sim-search/personal-source-setup' }),
      expect.objectContaining({
        body: {
          action: 'options',
          organizationId: 'org-1',
          connectorType: 'jira',
          credentialId: 'credential-1',
          domain: 'example.atlassian.net',
          request: { kind: 'list' },
        },
        signal: expect.any(AbortSignal),
      })
    )
    hook.rerender(() =>
      useSelectorOptions('jira.projectKeys', {
        context: { oauthCredential: 'credential-1', domain: 'example.atlassian.net' },
        scope: { kind: 'organization', organizationId: 'org-1' },
        surfaceId: 'projects',
      })
    )
    await waitFor(() =>
      expect(hook.getResult().data).toEqual([{ id: 'ADMIN', label: 'Admin project' }])
    )
    expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(1)
  })

  it.each(['selector', 'organization'] as const)(
    'rejects a mismatched personal setup %s before sending a request',
    async (mismatch) => {
      const hook = renderHookWithClient(() =>
        useSelectorOptions(mismatch === 'selector' ? 'confluence.spaces' : 'jira.projectKeys', {
          context: { oauthCredential: 'credential-1', domain: 'example.atlassian.net' },
          scope: {
            kind: 'organization',
            organizationId: mismatch === 'organization' ? 'org-2' : 'org-1',
          },
          surface: {
            kind: 'personal-search-setup',
            organizationId: 'org-1',
            connectorType: 'jira',
          },
        })
      )
      await waitFor(() => expect(hook.getResult().error).not.toBeNull())
      expect(mockRequestJson).not.toHaveBeenCalled()
      expect(mockExecuteSelectorRequest).not.toHaveBeenCalled()
    }
  )

  it('transports supported search and keeps context and request plaintext out of query keys', async () => {
    const credentialReference = '{{SHARED_GOOGLE_CREDENTIAL}}'
    const search = 'private search phrase'
    mockExecuteSelectorRequest.mockResolvedValue({
      kind: 'list',
      items: [{ id: 'file-1', label: 'Quarterly report' }],
    })

    const hook = renderHookWithClient(() =>
      useSelectorOptions('google.drive', {
        context: {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          oauthCredential: credentialReference,
          mimeType: 'application/private-canary',
        },
        search,
        surfaceId: 'canvas:block-1:file',
      })
    )

    await waitFor(() =>
      expect(hook.getResult().data).toEqual([{ id: 'file-1', label: 'Quarterly report' }])
    )

    expect(mockExecuteSelectorRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        selectorKey: 'google.drive',
        scope: {
          kind: 'workflow',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
        },
        context: {
          oauthCredential: credentialReference,
          mimeType: 'application/private-canary',
        },
        request: { kind: 'list', search },
        signal: expect.any(AbortSignal),
      })
    )
    const keys = serializedKeys(hook.queryClient)
    expect(keys).toContain('google.drive')
    expect(keys).not.toContain(credentialReference)
    expect(keys).not.toContain(search)
    expect(keys).not.toContain('application/private-canary')
  })

  it('refreshes from the first page before retrying a failed continuation cursor', async () => {
    let continuationAttempts = 0
    mockExecuteSelectorRequest.mockImplementation(
      async ({ request }: { request: { cursor?: string } }) => {
        if (request.cursor) {
          continuationAttempts += 1
          if (continuationAttempts === 1) throw new Error('Expired provider cursor')
          return { kind: 'list', items: [{ id: 'workspace-2', label: 'Second' }] }
        }
        return {
          kind: 'list',
          items: [{ id: 'workspace-1', label: 'First' }],
          nextCursor: 'fresh-provider-cursor',
        }
      }
    )

    const hook = renderHookWithClient(() =>
      useSelectorOptions('bitbucket.workspaces', {
        context: { workspaceId: 'workspace-1', oauthCredential: 'credential-1' },
        surfaceId: 'canvas:block-1:workspace',
      })
    )

    await waitFor(() => expect(hook.getResult().hasMore).toBe(true))
    act(() => hook.getResult().loadMore())
    await waitFor(() => expect(hook.getResult().error?.message).toBe('Expired provider cursor'))

    act(() => hook.getResult().loadMore())
    await waitFor(() => expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(4))

    expect(mockExecuteSelectorRequest.mock.calls[2][0].request).toEqual({ kind: 'list' })
    expect(mockExecuteSelectorRequest.mock.calls[3][0].request).toEqual({
      kind: 'list',
      cursor: 'fresh-provider-cursor',
    })
    expect(hook.getResult().data).toEqual([
      { id: 'workspace-1', label: 'First' },
      { id: 'workspace-2', label: 'Second' },
    ])
  })

  it('stops exposing continuation once 10,000 unique options are loaded', async () => {
    mockExecuteSelectorRequest.mockResolvedValue({
      kind: 'list',
      items: Array.from({ length: 10_000 }, (_, index) => ({
        id: `workspace-${index}`,
        label: `Workspace ${index}`,
      })),
      nextCursor: 'provider-has-more',
    })

    const hook = renderHookWithClient(() =>
      useSelectorOptions('bitbucket.workspaces', {
        context: { workspaceId: 'workspace-1', oauthCredential: 'credential-1' },
        surfaceId: 'canvas:block-1:workspace',
      })
    )

    await waitFor(() => expect(hook.getResult().data).toHaveLength(10_000))

    expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(1)
    expect(hook.getResult()).toMatchObject({ hasMore: false, truncated: true })
  })

  it('hydrates detail options while keeping the detail id and references out of its key', async () => {
    const detailId = 'private-issue-id'
    mockExecuteSelectorRequest.mockResolvedValue({
      kind: 'detail',
      item: { id: detailId, label: 'Issue label' },
    })

    const hook = renderHookWithClient(() =>
      useSelectorOptionDetail('jira.issues', {
        context: {
          workflowId: 'workflow-1',
          oauthCredential: '{{JIRA_CREDENTIAL}}',
          domain: '{{JIRA_DOMAIN}}',
        },
        detailId,
        surfaceId: 'canvas:block-1:issue',
      })
    )

    await waitFor(() =>
      expect(hook.getResult().data).toEqual({ id: detailId, label: 'Issue label' })
    )

    expect(mockExecuteSelectorRequest.mock.calls[0][0].request).toEqual({
      kind: 'detail',
      id: detailId,
    })
    const keys = serializedKeys(hook.queryClient)
    expect(keys).not.toContain(detailId)
    expect(keys).not.toContain('JIRA_CREDENTIAL')
    expect(keys).not.toContain('JIRA_DOMAIN')
  })
})
