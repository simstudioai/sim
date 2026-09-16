/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScimConnectionView } from '@/lib/api/contracts/organization-scim'

const { connectionQuery, issueCredential, useConnection, useGroups, useActivity } = vi.hoisted(
  () => ({
    connectionQuery: {
      data: undefined as { connection: ScimConnectionView } | undefined,
      isLoading: false,
      isError: false,
      error: null as Error | null,
      isFetching: false,
      refetch: vi.fn(),
    },
    issueCredential: vi.fn(),
    useConnection: vi.fn(),
    useGroups: vi.fn(),
    useActivity: vi.fn(),
  })
)

vi.mock('@/lib/core/config/deployment-shape', () => ({
  useDeploymentShape: () => ({ features: { scim: true } }),
}))

vi.mock('@/ee/access-control/hooks/permission-groups', () => ({
  usePermissionGroups: () => ({ data: [] }),
  useOrganizationWorkspaces: () => ({ data: [] }),
}))

vi.mock('@/ee/scim/hooks/scim', () => ({
  useScimConnection: useConnection,
  useScimGroupMappings: useGroups,
  useScimActivity: useActivity,
  useIssueScimCredential: () => ({ mutateAsync: issueCredential, isPending: false }),
  useConfigureScimConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeScimCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReconcileScimConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpsertScimGroupMapping: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteScimGroupMapping: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

import { ScimSection } from '@/ee/scim/components/scim-section'

let container: HTMLDivElement
let root: Root

function renderSection(active = true) {
  act(() => {
    root.render(<ScimSection organizationId='org-1' active={active} onOpenDomains={vi.fn()} />)
  })
}

function issueToken() {
  const button = Array.from(container.querySelectorAll('button')).find(
    (entry) => entry.textContent === 'Issue token'
  )
  expect(button).toBeDefined()
  button?.click()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  connectionQuery.data = {
    connection: {
      id: 'connection-1',
      status: 'active',
      baseUrl: 'https://sim.example.com/api/scim/v2',
      settings: {},
      lastRequestAt: null,
      reconciledAt: null,
      createdAt: '2026-09-07T00:00:00.000Z',
      credentials: [],
      userCount: 0,
      groupCount: 0,
    },
  }
  connectionQuery.isError = false
  connectionQuery.error = null
  useConnection.mockReturnValue(connectionQuery)
  useGroups.mockReturnValue({ data: [], isLoading: false, isError: false })
  useActivity.mockReturnValue({ data: [], isLoading: false, isError: false })
  issueCredential.mockResolvedValue({ secret: 'one-time-token' })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('SCIM credential recovery', () => {
  it('keeps the issued token available when a background connection refresh fails', async () => {
    renderSection()
    await act(async () => issueToken())
    expect(document.querySelector('input[value="one-time-token"]')).not.toBeNull()

    connectionQuery.isError = true
    connectionQuery.error = new Error('Connection refresh failed')
    renderSection()

    expect(document.querySelector('input[value="one-time-token"]')).not.toBeNull()
  })

  it('retains a token issued while inactive and pauses its queries until the tab returns', async () => {
    const issued = Promise.withResolvers<{ secret: string }>()
    issueCredential.mockReturnValue(issued.promise)
    renderSection()
    act(issueToken)
    renderSection(false)
    await act(async () => issued.resolve({ secret: 'one-time-token' }))

    expect(document.querySelector('input[value="one-time-token"]')).toBeNull()
    expect(useConnection).toHaveBeenLastCalledWith('org-1', false)
    expect(useGroups).toHaveBeenLastCalledWith('org-1', false)
    expect(useActivity).toHaveBeenLastCalledWith('org-1', false)

    renderSection()
    expect(document.querySelector('input[value="one-time-token"]')).not.toBeNull()
  })

  it('shows an actionable error when the first connection request fails', () => {
    connectionQuery.data = undefined
    connectionQuery.isError = true
    connectionQuery.error = new Error('Connection unavailable')
    renderSection()

    expect(container).toHaveTextContent('Connection unavailable')
    const retry = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Try again'
    )
    expect(retry).toBeDefined()
    act(() => retry?.click())
    expect(connectionQuery.refetch).toHaveBeenCalledOnce()
  })
})
