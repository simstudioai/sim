/**
 * @vitest-environment jsdom
 *
 * Leaving a fork's sync page goes through the shared Settings leave guard. Failure modes: Back
 * drops another editor's unsaved draft without the discard prompt, or leaves while a write is still
 * underway.
 */
import { act } from 'react'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { jsonResponse } from '@sim/testing/helpers/http'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)

import { ForkSyncDetail } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-sync-detail'
import { useSettingsDirtyStore } from '@/platform/lib/data/settings-guard'

const PARENT = { id: 'parent-a', name: 'Parent', organizationId: null, viewerAccessible: true }

/** `forkKeys` is private to its hook module; these are its push-direction keys for this edge. */
const MAPPING_KEY = ['workspace-fork', 'mapping', 'workspace-a', 'parent-a', 'push']
const DIFF_KEY = ['workspace-fork', 'diff', 'workspace-a', 'parent-a', 'push']

let root: Root
let container: HTMLDivElement
let client: QueryClient

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse({ error: 'Not found' }, 404)))
  )
  useSettingsDirtyStore.getState().reset()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
  client.setQueryData(MAPPING_KEY, { entries: [] })
  client.setQueryData(DIFF_KEY, {
    sourceWorkspaceId: 'workspace-a',
    targetWorkspaceId: 'parent-a',
    workflows: [],
    sourceVersions: [],
    dependentReconfigs: [],
    resourceUsages: [],
    copyableUnmapped: [],
    clearedRefs: [],
    triggerMappings: [],
    retiringTriggerUrls: [],
    excludedSourceWorkflows: [],
    excludedTargetWorkflows: [],
    mcpReauthServerIds: [],
    inlineSecretSources: [],
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
    await flushMicrotasks()
  })
  client.clear()
  container.remove()
  vi.useRealTimers()
})

function click(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === text
  )
  if (!button) throw new Error(`Missing button ${text}`)
  act(() => button.click())
}

it.each(['dirty', 'busy'])('holds Back while another editor is %s', async (condition) => {
  let backs = 0
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter hasMemory searchParams='?fork-id=parent-a'>
          <ForkSyncDetail
            workspaceId='workspace-a'
            workspaceName='Current'
            parent={PARENT}
            onBack={() => {
              backs += 1
            }}
            onOpenWorkspace={() => {}}
          />
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(10)
  })
  act(() =>
    useSettingsDirtyStore.getState().setGuard('test-editor', {
      isDirty: condition === 'dirty',
      navigationBlocked: condition === 'busy',
    })
  )
  click('Workspace forks')
  expect(backs).toBe(0)
  act(() => useSettingsDirtyStore.getState().confirmLeave())
  expect(backs).toBe(condition === 'dirty' ? 1 : 0)
})
