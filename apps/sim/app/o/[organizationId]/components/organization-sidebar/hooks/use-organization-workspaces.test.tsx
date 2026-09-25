/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => ({ requestJson: vi.fn() }))

import { useOrganizationWorkspaces } from '@/app/o/[organizationId]/components/organization-sidebar/hooks/use-organization-workspaces'
import { workspaceKeys } from '@/hooks/queries/workspace'

/** In the order the server returns them: most recently visited first. */
const workspaces = [
  { id: 'recent', organizationId: 'org-1' },
  { id: 'other-org', organizationId: 'org-2' },
  { id: 'earlier', organizationId: 'org-1' },
  { id: 'unvisited', organizationId: 'org-1' },
]

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

/** A client holding the list exactly as the layout prefetch hydrates it. */
function seededClient(pinnedWorkspaceIds: string[]) {
  const queryClient = new QueryClient()
  queryClient.setQueryData(workspaceKeys.list('active'), {
    workspaces,
    lastActiveWorkspaceId: null,
    pinnedWorkspaceIds,
    creationPolicy: null,
  })
  return queryClient
}

let container: HTMLDivElement
let root: Root | undefined

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  container.remove()
  vi.unstubAllGlobals()
})

function workspaceIds() {
  return Array.from(container.querySelectorAll('li'), (item) => item.textContent)
}

/** Server-renders, hydrates, and fails if hydration changed a single DOM node. */
async function renderAndHydrate(pinnedWorkspaceIds: string[] = []) {
  container.innerHTML = renderToString(
    <QueryClientProvider client={seededClient(pinnedWorkspaceIds)}>
      <Harness />
    </QueryClientProvider>
  )
  const serverOrder = workspaceIds()
  const onRecoverableError = vi.fn()
  const mutations: MutationRecord[] = []
  const observer = new MutationObserver((records) => mutations.push(...records))
  observer.observe(container, { childList: true, subtree: true, characterData: true })
  await act(async () => {
    root = hydrateRoot(
      container,
      <QueryClientProvider client={seededClient(pinnedWorkspaceIds)}>
        <Harness />
      </QueryClientProvider>,
      { onRecoverableError }
    )
  })
  observer.disconnect()
  expect(onRecoverableError).not.toHaveBeenCalled()
  expect(mutations).toEqual([])
  return serverOrder
}

describe('useOrganizationWorkspaces', () => {
  it('renders the server visit order so hydration never reshuffles rows', async () => {
    expect(await renderAndHydrate()).toEqual(['recent', 'earlier', 'unvisited'])
  })

  it('lifts pins above the visit order', async () => {
    expect(await renderAndHydrate(['unvisited'])).toEqual(['unvisited', 'recent', 'earlier'])
  })

  it('does not reorder the cached list', async () => {
    await renderAndHydrate(['unvisited'])
    expect(workspaces.map(({ id }) => id)).toEqual(['recent', 'other-org', 'earlier', 'unvisited'])
  })
})
