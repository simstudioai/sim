/** @vitest-environment jsdom */
import { act, createRef } from 'react'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { integrationMatcherMock } from '@sim/testing/mocks/integration-matcher.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PlusMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import { PlusMenuDropdown } from '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/plus-menu-dropdown'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { workspaceKeys } from '@/hooks/queries/workspace'

vi.mock('@/blocks/integration-matcher', () => ({
  ...integrationMatcherMock,
  listIntegrationsByPopularity: () => [],
}))

vi.mock(
  'next/navigation',
  async () => (await import('@sim/testing/mocks/next-navigation.mock')).nextNavigationMock
)

let client: QueryClient
let root: Root
let container: HTMLDivElement
const handle = createRef<PlusMenuHandle>()
let selected: { id: string; name: string } | null = null
const selectProject = (project: { id: string; name: string }) => {
  selected = { id: project.id, name: project.name }
}
const project = {
  id: 'project',
  name: 'Gate fixture',
  organizationId: 'organization',
  ownerId: 'user',
  archivedAt: null,
  createdAt: '2026-10-08T00:00:00Z',
  updatedAt: '2026-10-08T00:00:00Z',
  environments: [],
  capabilities: { administer: true, issues: true },
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  Element.prototype.scrollIntoView = vi.fn()
  selected = null
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(workspaceKeys.list(), { workspaces: [] })
  vi.stubGlobal('fetch', async (input: string) =>
    Response.json(
      input.startsWith('/api/projects?') ? { projects: [project], nextCursor: null } : {}
    )
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.useRealTimers()
})
async function render(projectFiles: boolean) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <FeatureFlagsProvider
          flags={{
            projects: true,
            'project-files': projectFiles,
            dashboards: false,
            'mothership-model-selector': false,
            'mothership-plan-mode': false,
          }}
        >
          <PlusMenuDropdown
            ref={handle}
            workspaceId=''
            organizationId='organization'
            warm
            onResourceSelect={() => {}}
            onWorkspaceSelect={() => {}}
            onProjectSelect={selectProject}
            onClose={() => {}}
            textareaRef={{ current: null }}
            pendingCursorRef={{ current: null }}
            mentionQuery={project.name}
          />
        </FeatureFlagsProvider>
      </QueryClientProvider>
    )
  )
  await act(async () => vi.advanceTimersByTimeAsync(10))
}
it('stops cached Project mention selection when Project files are disabled', async () => {
  await render(true)
  await act(async () => handle.current?.open({ left: 0, top: 0 }, { mention: true }))
  await act(async () => handle.current?.selectActive())
  expect(selected).toEqual(expect.objectContaining({ id: project.id, name: project.name }))
  selected = null
  await render(false)
  await act(async () => handle.current?.open({ left: 0, top: 0 }, { mention: true }))
  await act(async () => handle.current?.selectActive())
  expect(selected).toBeNull()
})
it('stops Project tagging through the browse submenu when Project files are disabled', async () => {
  await render(true)
  await act(async () => handle.current?.open({ left: 0, top: 0 }))
  const selectProject = async () => {
    const trigger = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent === project.name
    )
    if (!trigger) throw new Error('Project fixture was not available for environment browsing')
    await act(async () => trigger.click())
  }
  await selectProject()
  expect(selected).toEqual(expect.objectContaining({ id: project.id }))
  selected = null
  await render(false)
  await act(async () => handle.current?.open({ left: 0, top: 0 }))
  await selectProject()
  expect(selected).toBeNull()
})

it('only waits for pending Projects when Project mentions are selectable', async () => {
  const response = createDeferred<Response>()
  vi.stubGlobal('fetch', (input: string) =>
    input.startsWith('/api/projects?') ? response.promise : Promise.resolve(Response.json({}))
  )
  try {
    await render(true)
    await act(async () => handle.current?.open({ left: 0, top: 0 }, { mention: true }))
    expect(handle.current?.selectActive()).toBe('hydrating')
    await render(false)
    expect(handle.current?.selectActive()).toBe('empty')
  } finally {
    await act(async () => response.resolve(Response.json({ projects: [], nextCursor: null })))
  }
})
