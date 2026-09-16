/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteSelectorRequest, mockRequestJson } = vi.hoisted(() => ({
  mockExecuteSelectorRequest: vi.fn(),
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/selectors/client/execute-selector', () => ({
  executeSelectorRequest: mockExecuteSelectorRequest,
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

import {
  type SelectorLoadAllResult,
  useSelectorOptionDetail,
  useSelectorOptions,
} from '@/hooks/queries/selectors'

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

beforeEach(() => {
  vi.clearAllMocks()
})

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

  it('hydrates personal setup labels through the same dedicated contract', async () => {
    mockRequestJson.mockResolvedValue({
      success: true,
      data: { kind: 'detail', item: { id: 'ENG', label: 'Engineering' } },
    })
    const hook = renderHookWithClient(() =>
      useSelectorOptionDetail('confluence.spaces', {
        context: { oauthCredential: 'credential-1', domain: 'example.atlassian.net' },
        scope: { kind: 'organization', organizationId: 'org-1' },
        surface: {
          kind: 'personal-search-setup',
          organizationId: 'org-1',
          connectorType: 'confluence',
        },
        detailId: 'ENG',
      })
    )
    await waitFor(() => expect(hook.getResult().data?.id).toBe('ENG'))
    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.objectContaining({
          connectorType: 'confluence',
          request: { kind: 'detail', id: 'ENG' },
        }),
      })
    )
    expect(mockExecuteSelectorRequest).not.toHaveBeenCalled()
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

  it.each(['flat', 'paged'] as const)('returns a complete already-loaded %s list', async (mode) => {
    const items = [{ id: 'ENG', label: 'Engineering' }]
    mockExecuteSelectorRequest.mockResolvedValue({ kind: 'list', items })
    const hook = renderHookWithClient(() =>
      useSelectorOptions(mode === 'paged' ? 'jira.projectKeys' : 'jira.issues', {
        context: {
          workspaceId: 'workspace-1',
          oauthCredential: 'credential-1',
          domain: 'example.atlassian.net',
        },
      })
    )
    await waitFor(() => expect(hook.getResult().isSuccess).toBe(true))
    let result: SelectorLoadAllResult | undefined
    await act(async () => {
      result = await hook.getResult().loadAll()
    })
    expect(result).toEqual({ status: 'complete', options: items })
    expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(1)
  })

  it.each(['provider', 'options', 'pages'] as const)(
    'reports %s truncation without a complete selection',
    async (kind) => {
      mockExecuteSelectorRequest.mockImplementation(
        async ({ request }: { request: { cursor?: string } }) => ({
          kind: 'list',
          items:
            kind === 'options'
              ? Array.from({ length: 10_001 }, (_, index) => ({
                  id: String(index),
                  label: String(index),
                }))
              : [{ id: request.cursor ?? '0', label: 'Project' }],
          ...(kind === 'pages' ? { nextCursor: String(Number(request.cursor ?? '0') + 1) } : {}),
          ...(kind === 'provider' ? { truncated: true } : {}),
        })
      )
      const hook = renderHookWithClient(() =>
        useSelectorOptions('jira.projectKeys', {
          context: {
            workspaceId: 'workspace-1',
            oauthCredential: 'credential-1',
            domain: 'example.atlassian.net',
          },
        })
      )
      await waitFor(() => expect(hook.getResult().isSuccess).toBe(true))
      let result: SelectorLoadAllResult | undefined
      await act(async () => {
        result = await hook.getResult().loadAll()
      })
      expect(result).toEqual({ status: 'partial' })
      expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(kind === 'pages' ? 200 : 1)
    }
  )

  it('reports a failed continuation and retries from the first page', async () => {
    let fail = true
    mockExecuteSelectorRequest.mockImplementation(
      async ({ request }: { request: { cursor?: string } }) => {
        if (request.cursor && fail) throw new Error('Provider is unavailable')
        return request.cursor
          ? { kind: 'list', items: [{ id: 'OPS', label: 'Operations' }] }
          : { kind: 'list', items: [{ id: 'ENG', label: 'Engineering' }], nextCursor: 'next' }
      }
    )
    const hook = renderHookWithClient(() =>
      useSelectorOptions('jira.projectKeys', {
        context: {
          workspaceId: 'workspace-1',
          oauthCredential: 'credential-1',
          domain: 'example.atlassian.net',
        },
      })
    )
    await waitFor(() => expect(hook.getResult().hasMore).toBe(true))
    let result: SelectorLoadAllResult | undefined
    await act(async () => {
      result = await hook.getResult().loadAll()
    })
    expect(result).toEqual({ status: 'error' })
    await waitFor(() => expect(hook.getResult().error).toBeTruthy())
    fail = false
    await act(async () => {
      result = await hook.getResult().loadAll()
    })
    expect(result).toEqual({
      status: 'complete',
      options: [
        { id: 'ENG', label: 'Engineering' },
        { id: 'OPS', label: 'Operations' },
      ],
    })
    expect(mockExecuteSelectorRequest.mock.calls.map(([args]) => args.request.cursor)).toEqual([
      undefined,
      'next',
      undefined,
      'next',
    ])
  })

  it.each(['scope', 'surface', 'credential', 'site', 'search', 'disabled', 'unmount'] as const)(
    'cancels bulk selection when its %s changes',
    async (change) => {
      let resolvePage!: (result: {
        kind: 'list'
        items: { id: string; label: string }[]
        nextCursor?: string
      }) => void
      const pending = new Promise<{
        kind: 'list'
        items: { id: string; label: string }[]
        nextCursor?: string
      }>((resolve) => {
        resolvePage = resolve
      })
      mockExecuteSelectorRequest.mockImplementation(
        ({ request }: { request: { cursor?: string } }) =>
          request.cursor
            ? pending
            : Promise.resolve({
                kind: 'list',
                items: [{ id: 'ENG', label: 'Engineering' }],
                nextCursor: 'next',
              })
      )
      let workspaceId = 'workspace-1'
      let surfaceId = 'field-1'
      let credentialId = 'credential-1'
      let domain = 'example.atlassian.net'
      let search = ''
      let enabled = true
      const useHook = () =>
        useSelectorOptions('jira.projectKeys', {
          context: { workspaceId, oauthCredential: credentialId, domain },
          surfaceId,
          search,
          enabled,
        })
      const hook = renderHookWithClient(useHook)
      await waitFor(() => expect(hook.getResult().hasMore).toBe(true))
      let result!: Promise<SelectorLoadAllResult>
      act(() => {
        result = hook.getResult().loadAll()
      })
      await waitFor(() => expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(2))
      if (change === 'scope') workspaceId = 'workspace-2'
      if (change === 'surface') surfaceId = 'field-2'
      if (change === 'credential') credentialId = 'credential-2'
      if (change === 'site') domain = 'another.atlassian.net'
      if (change === 'search') search = 'Operations'
      if (change === 'disabled') enabled = false
      if (change === 'unmount') hook.unmount()
      else hook.rerender(useHook)
      await act(async () => {
        resolvePage({
          kind: 'list',
          items: [{ id: 'OPS', label: 'Operations' }],
          nextCursor: 'unused',
        })
        expect(await result).toEqual({ status: 'cancelled' })
      })
      expect(
        mockExecuteSelectorRequest.mock.calls.filter(([args]) => args.request.cursor)
      ).toHaveLength(1)
      if (change !== 'unmount') expect(hook.getResult().isLoadingAll).toBe(false)
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

  it('omits unsupported search without needlessly issuing another request when it changes', async () => {
    mockExecuteSelectorRequest.mockResolvedValue({ kind: 'list', items: [] })
    let search = 'first private phrase'
    const useHook = () =>
      useSelectorOptions('gmail.labels', {
        context: {
          workspaceId: 'workspace-1',
          oauthCredential: '{{GMAIL_CREDENTIAL}}',
        },
        search,
        surfaceId: 'connector:gmail:label',
      })
    const hook = renderHookWithClient(useHook)

    await waitFor(() => expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(1))
    expect(mockExecuteSelectorRequest.mock.calls[0][0].request).toEqual({ kind: 'list' })

    search = 'second private phrase'
    hook.rerender(useHook)
    await act(async () => {
      await sleep(5)
    })

    expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(1)
    expect(serializedKeys(hook.queryClient)).not.toContain('private phrase')
  })

  it('uses distinct opaque revisions without retaining obsolete query closures', async () => {
    mockExecuteSelectorRequest.mockResolvedValue({ kind: 'list', items: [] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let credential = '{{FIRST_SHARED_CREDENTIAL}}'
    const useHook = () =>
      useSelectorOptions('gmail.labels', {
        context: { workspaceId: 'workspace-1', oauthCredential: credential },
        surfaceId: 'canvas:block-1:label',
      })
    const first = renderHookWithClient(useHook, queryClient)
    await waitFor(() => expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(1))

    credential = '{{SECOND_SHARED_CREDENTIAL}}'
    first.rerender(useHook)
    await waitFor(() => expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      const revisions = queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey)
        .filter((key) => key.at(-1) !== 'paged')
        .map((key) => key.at(-1))
      expect(new Set(revisions).size).toBe(1)
    })
    first.unmount()
    await waitFor(() => expect(queryClient.getQueryCache().getAll()).toHaveLength(0))

    const second = renderHookWithClient(useHook, queryClient)
    await waitFor(() => expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(3))

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey)
    const revisions = keys.filter((key) => key.at(-1) !== 'paged').map((key) => key.at(-1))
    expect(new Set(revisions).size).toBe(1)
    expect(serializedKeys(queryClient)).not.toContain('SHARED_CREDENTIAL')
    second.unmount()
  })

  it.each(['gmail.labels', 'bitbucket.workspaces'] as const)(
    'does not manually refetch the unready %s selector',
    async (selectorKey) => {
      mockExecuteSelectorRequest.mockResolvedValue({ kind: 'list', items: [] })
      const hook = renderHookWithClient(() =>
        useSelectorOptions(selectorKey, {
          context: { workspaceId: 'workspace-1' },
          surfaceId: `connector:${selectorKey}:field`,
        })
      )

      act(() => hook.getResult().refetch())
      await act(async () => {
        await sleep(5)
      })

      expect(mockExecuteSelectorRequest).not.toHaveBeenCalled()
    }
  )

  it.each([true, false, undefined])(
    'preserves flat selector truncation %s and clears it after a complete refetch',
    async (truncated) => {
      const items = [{ id: 'label-1', label: 'First label' }]
      mockExecuteSelectorRequest.mockResolvedValue({
        kind: 'list',
        items,
        ...(truncated !== undefined ? { truncated } : {}),
      })
      const hook = renderHookWithClient(() =>
        useSelectorOptions('gmail.labels', {
          context: { workspaceId: 'workspace-1', oauthCredential: 'credential-1' },
          surfaceId: 'connector:gmail:label',
        })
      )

      await waitFor(() => expect(hook.getResult().isSuccess).toBe(true))
      expect(hook.getResult()).toMatchObject({
        data: items,
        hasMore: false,
        truncated: truncated === true,
      })

      const refreshedItems = [{ id: 'label-2', label: 'Complete results' }]
      mockExecuteSelectorRequest.mockResolvedValue({ kind: 'list', items: refreshedItems })
      act(() => hook.getResult().refetch())

      await waitFor(() => expect(hook.getResult().data).toEqual(refreshedItems))
      expect(hook.getResult()).toMatchObject({ hasMore: false, truncated: false })
    }
  )

  it('retains server truncation from earlier pages after loading the final page', async () => {
    mockExecuteSelectorRequest.mockImplementation(
      async ({ request }: { request: { cursor?: string } }) =>
        request.cursor
          ? { kind: 'list', items: [{ id: 'workspace-2', label: 'Second' }], truncated: false }
          : {
              kind: 'list',
              items: [{ id: 'workspace-1', label: 'First' }],
              nextCursor: 'next-page',
              truncated: true,
            }
    )
    const hook = renderHookWithClient(() =>
      useSelectorOptions('bitbucket.workspaces', {
        context: { workspaceId: 'workspace-1', oauthCredential: 'credential-1' },
        surfaceId: 'canvas:block-1:workspace',
      })
    )

    await waitFor(() => expect(hook.getResult().hasMore).toBe(true))
    expect(hook.getResult().truncated).toBe(true)

    act(() => hook.getResult().loadMore())
    await waitFor(() =>
      expect(hook.getResult().data).toEqual([
        { id: 'workspace-1', label: 'First' },
        { id: 'workspace-2', label: 'Second' },
      ])
    )
    expect(hook.getResult()).toMatchObject({ hasMore: false, truncated: true })
  })

  it('loads paginated selectors on demand without putting cursors in the base key', async () => {
    mockExecuteSelectorRequest.mockImplementation(
      async ({ request }: { request: { cursor?: string } }) =>
        request.cursor
          ? { kind: 'list', items: [{ id: 'repo-2', label: 'Second' }] }
          : {
              kind: 'list',
              items: [{ id: 'repo-1', label: 'First' }],
              nextCursor: 'private-provider-cursor',
            }
    )

    const hook = renderHookWithClient(() =>
      useSelectorOptions('bitbucket.workspaces', {
        context: { workspaceId: 'workspace-1', oauthCredential: '{{BITBUCKET_CREDENTIAL}}' },
        surfaceId: 'canvas:block-1:workspace',
      })
    )

    await waitFor(() => expect(hook.getResult().data).toEqual([{ id: 'repo-1', label: 'First' }]))

    expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(1)
    expect(hook.getResult()).toMatchObject({ hasMore: true, truncated: false })

    act(() => hook.getResult().loadMore())
    await waitFor(() =>
      expect(hook.getResult().data).toEqual([
        { id: 'repo-1', label: 'First' },
        { id: 'repo-2', label: 'Second' },
      ])
    )

    expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(2)
    expect(mockExecuteSelectorRequest.mock.calls[1][0].request).toEqual({
      kind: 'list',
      cursor: 'private-provider-cursor',
    })
    expect(serializedKeys(hook.queryClient)).not.toContain('private-provider-cursor')
    expect(hook.getResult()).toMatchObject({ hasMore: false, truncated: false })
  })

  it('searches every remaining page only after an explicit load-all request', async () => {
    mockExecuteSelectorRequest.mockImplementation(
      async ({ request }: { request: { cursor?: string } }) => {
        const page = Number(request.cursor ?? '0')
        return {
          kind: 'list',
          items: [
            { id: `workspace-${page}`, label: `Workspace ${page}` },
            ...(page === 1 ? [{ id: 'workspace-0', label: 'Duplicate' }] : []),
          ],
          ...(page < 2 ? { nextCursor: String(page + 1) } : {}),
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
    expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(1)

    let result: SelectorLoadAllResult | undefined
    await act(async () => {
      result = await hook.getResult().loadAll()
    })
    await waitFor(() => expect(hook.getResult().isLoadingAll).toBe(false))

    expect(mockExecuteSelectorRequest).toHaveBeenCalledTimes(3)
    expect(hook.getResult().data).toEqual([
      { id: 'workspace-0', label: 'Workspace 0' },
      { id: 'workspace-1', label: 'Workspace 1' },
      { id: 'workspace-2', label: 'Workspace 2' },
    ])
    expect(hook.getResult()).toMatchObject({ hasMore: false, truncated: false })
    expect(result).toEqual({ status: 'complete', options: hook.getResult().data })
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

  it('forwards React Query cancellation to selector execution', async () => {
    let requestSignal: AbortSignal | undefined
    mockExecuteSelectorRequest.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          requestSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )

    const hook = renderHookWithClient(() =>
      useSelectorOptions('gmail.labels', {
        context: { workspaceId: 'workspace-1', oauthCredential: 'credential-1' },
        surfaceId: 'connector:gmail:label',
      })
    )
    await waitFor(() => expect(requestSignal).toBeDefined())

    hook.unmount()

    expect(requestSignal?.aborted).toBe(true)
  })
})
