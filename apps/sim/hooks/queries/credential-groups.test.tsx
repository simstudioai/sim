/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getWorkspaceAccountsContract,
  type WorkspaceAccountsSettings,
} from '@/lib/api/contracts/credential-groups'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

import { useWorkspaceAccounts } from '@/hooks/queries/credential-groups'
import { credentialGroupKeys } from '@/hooks/queries/utils/credential-group-queries'

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

const WORKSPACE_ID = 'workspace-1'
const GROUP_ID = 'group-1'

const mountedRoots: Root[] = []

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
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
    mockRequestJson.mockImplementation(() => new Promise<WorkspaceAccountsSettings>(() => {}))
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
    expect(mockRequestJson).not.toHaveBeenCalled()
    render(WORKSPACE_ID)
    expect(current?.data).toEqual(settings)
    render('workspace-2')
    expect(current?.data).toBeUndefined()
    expect(current?.isPending).toBe(true)
    expect(mockRequestJson).toHaveBeenCalledWith(getWorkspaceAccountsContract, {
      params: { id: 'workspace-2' },
      signal: expect.any(AbortSignal),
    })
    expect(queryClient.getQueryData(credentialGroupKeys.workspace(WORKSPACE_ID))).toEqual(settings)
  })
})
