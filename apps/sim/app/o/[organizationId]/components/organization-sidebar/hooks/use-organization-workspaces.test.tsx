/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRecencyProvider } from '@/components/workspaces/workspace-recency-provider'
import { STORAGE_KEYS, WorkspaceRecencyStorage } from '@/lib/core/utils/browser-storage'
import { WORKSPACE_RECENCY_COOKIE } from '@/lib/workspaces/recency-cookie'

const { mockUseWorkspacesQuery, pins } = vi.hoisted(() => ({
  pins: { current: new Set<string>() },
  mockUseWorkspacesQuery: vi.fn(),
}))

vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacesQuery: mockUseWorkspacesQuery,
  EMPTY_PINNED_WORKSPACE_IDS: new Set<string>(),
  usePinnedWorkspaceIds: () => ({ data: pins.current }),
}))

import { useOrganizationWorkspaces } from '@/app/o/[organizationId]/components/organization-sidebar/hooks/use-organization-workspaces'

function Harness() {
  const { workspaces } = useOrganizationWorkspaces('org-1')
  return (
    <ul>
      {workspaces.map((workspace) => (
        <li key={workspace.id}>{workspace.id}</li>
      ))}
    </ul>
  )
}

let container: HTMLDivElement
let root: Root | undefined

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  pins.current = new Set()
  mockUseWorkspacesQuery.mockReturnValue({
    data: [
      { id: 'newest', organizationId: 'org-1' },
      { id: 'other-org', organizationId: 'org-2' },
      { id: 'older', organizationId: 'org-1' },
      { id: 'oldest', organizationId: 'org-1' },
    ],
    isLoading: false,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  container.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
})

function workspaceIds() {
  return Array.from(container.querySelectorAll('li'), (item) => item.textContent)
}

describe('useOrganizationWorkspaces', () => {
  it('renders the visit order on the server so hydration does not reshuffle rows', async () => {
    localStorage.setItem(
      STORAGE_KEYS.WORKSPACE_RECENCY,
      JSON.stringify({ oldest: 100, older: 200, 'other-org': 300 })
    )
    const recentIds = ['other-org', 'older', 'oldest']
    const tree = (
      <WorkspaceRecencyProvider recentWorkspaceIds={recentIds}>
        <Harness />
      </WorkspaceRecencyProvider>
    )
    container.innerHTML = renderToString(tree)
    expect(workspaceIds()).toEqual(['older', 'oldest', 'newest'])

    const onRecoverableError = vi.fn()
    const observed: string[][] = []
    const observer = new MutationObserver(() => observed.push(workspaceIds()))
    observer.observe(container, { childList: true, subtree: true, characterData: true })
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError })
    })
    observer.disconnect()

    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(observed).toEqual([])
    expect(workspaceIds()).toEqual(['older', 'oldest', 'newest'])
    expect(mockUseWorkspacesQuery().data.map(({ id }: { id: string }) => id)).toEqual([
      'newest',
      'other-org',
      'older',
      'oldest',
    ])
  })

  it('mirrors visits into the recency cookie', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness />)
    })
    await act(async () => WorkspaceRecencyStorage.touch('older'))
    expect(document.cookie).toContain(`${WORKSPACE_RECENCY_COOKIE}=older`)
  })

  it('preserves creation-date order when the browser has no visit history', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness />)
    })

    expect(workspaceIds()).toEqual(['newest', 'older', 'oldest'])
  })
  it('keeps pins first and reacts to visits without mutating the query cache', async () => {
    pins.current = new Set(['oldest'])
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness />)
    })
    expect(workspaceIds()).toEqual(['oldest', 'newest', 'older'])
    await act(async () => WorkspaceRecencyStorage.touch('older'))
    expect(workspaceIds()).toEqual(['oldest', 'older', 'newest'])
    pins.current = new Set()
    await act(async () => root?.render(<Harness />))
    expect(workspaceIds()).toEqual(['older', 'newest', 'oldest'])
  })

  it('follows visit history changed by another tab', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness />)
    })
    await act(async () => {
      localStorage.setItem(STORAGE_KEYS.WORKSPACE_RECENCY, JSON.stringify({ oldest: 300 }))
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.WORKSPACE_RECENCY }))
    })
    expect(workspaceIds()).toEqual(['oldest', 'newest', 'older'])
  })
})
