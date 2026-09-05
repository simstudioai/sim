/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type CredentialGroupAccessResponse,
  getWorkspaceAccountsContract,
  type WorkspaceAccountsSettings,
} from '@/lib/api/contracts/credential-groups'

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import {
  useUpdateCredentialGroupAccess,
  useWorkspaceAccounts,
} from '@/hooks/queries/credential-groups'
import { credentialGroupKeys } from '@/hooks/queries/utils/credential-group-queries'

const WORKSPACE_ID = 'workspace-1'
const GROUP_ID = 'group-1'
const ACCESS_QUERY_KEY = credentialGroupKeys.access(WORKSPACE_ID, GROUP_ID)
const CACHED_ACCESS: CredentialGroupAccessResponse = {
  revision: 3,
  allowedWorkflowIds: ['workflow-1'],
  workflows: [
    { id: 'workflow-1', name: 'Finance workflow' },
    { id: 'workflow-2', name: 'Support workflow' },
  ],
}

const mountedRoots: Root[] = []

function renderMutation(queryClient: QueryClient) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  let result: ReturnType<typeof useUpdateCredentialGroupAccess> | undefined

  function Probe() {
    result = useUpdateCredentialGroupAccess()
    return null
  }

  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    )
  )

  return () => {
    if (!result) throw new Error('Credential Group access mutation did not render')
    return result
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requestJson.mockResolvedValue({ revision: 4, allowedWorkflowIds: ['workflow-2'] })
})

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
})

describe('useUpdateCredentialGroupAccess', () => {
  it('seeds the exact access cache from the mutation response while preserving the catalog', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    queryClient.setQueryData(ACCESS_QUERY_KEY, CACHED_ACCESS)
    const getMutation = renderMutation(queryClient)

    await act(async () =>
      getMutation().mutateAsync({
        workspaceId: WORKSPACE_ID,
        groupId: GROUP_ID,
        body: { expectedRevision: 3, allowedWorkflowIds: ['workflow-2'] },
      })
    )

    expect(queryClient.getQueryData<CredentialGroupAccessResponse>(ACCESS_QUERY_KEY)).toEqual({
      revision: 4,
      allowedWorkflowIds: ['workflow-2'],
      workflows: CACHED_ACCESS.workflows,
    })
  })

  it('fails before the request when the access cache has not been loaded', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const getMutation = renderMutation(queryClient)

    await expect(
      act(async () =>
        getMutation().mutateAsync({
          workspaceId: WORKSPACE_ID,
          groupId: GROUP_ID,
          body: { expectedRevision: 3, allowedWorkflowIds: ['workflow-2'] },
        })
      )
    ).rejects.toThrow('Credential Group access must be loaded before it can be updated')
    expect(mocks.requestJson).not.toHaveBeenCalled()
  })
})

describe('useWorkspaceAccounts', () => {
  it('keeps account records scoped to their workspace while the next workspace loads', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const settings: WorkspaceAccountsSettings = {
      credentialGroup: {
        id: GROUP_ID,
        workspaceId: WORKSPACE_ID,
        name: 'Connected accounts',
        description: null,
        options: [],
        mcpServers: [],
        status: 'active',
        createdAt: '2026-09-04T00:00:00Z',
        updatedAt: '2026-09-04T00:00:00Z',
      },
      availableProviders: ['slack'],
    }
    queryClient.setQueryData(credentialGroupKeys.workspace(WORKSPACE_ID), settings)
    mocks.requestJson.mockImplementation(() => new Promise<WorkspaceAccountsSettings>(() => {}))
    const root = createRoot(document.createElement('div'))
    mountedRoots.push(root)
    let current: ReturnType<typeof useWorkspaceAccounts> | undefined
    function Probe({ workspaceId }: { workspaceId?: string }) {
      current = useWorkspaceAccounts(workspaceId)
      return null
    }
    function render(workspaceId?: string) {
      act(() =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <Probe workspaceId={workspaceId} />
          </QueryClientProvider>
        )
      )
    }
    render()
    expect(mocks.requestJson).not.toHaveBeenCalled()
    render(WORKSPACE_ID)
    expect(current?.data).toEqual(settings)
    render('workspace-2')
    expect(current?.data).toBeUndefined()
    expect(current?.isPending).toBe(true)
    expect(mocks.requestJson).toHaveBeenCalledWith(getWorkspaceAccountsContract, {
      params: { id: 'workspace-2' },
      signal: expect.any(AbortSignal),
    })
    expect(queryClient.getQueryData(credentialGroupKeys.workspace(WORKSPACE_ID))).toEqual(settings)
  })
})
