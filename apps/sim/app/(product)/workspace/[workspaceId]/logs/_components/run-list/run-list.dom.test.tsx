/**
 * @vitest-environment jsdom
 *
 * The run list pages in more runs as the reader nears its end, so it can hold thousands. Failure
 * modes: every loaded run mounting a row, so the DOM grows without bound as pages arrive; and a
 * windowed list dropping the run the reader stepped to in its details, so returning to the list
 * cannot scroll that run into view.
 */
import { act, type ReactNode } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)

import {
  useRevealOnReturn,
  WorkspaceSession,
} from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import { RunList } from '@/app/(product)/workspace/[workspaceId]/logs/_components/run-list/run-list'
import { SurfaceScopeProvider } from '@/platform/lib/surface-scope'
import type { RunSummary } from '@/platform/shared/workspace-records'

const RUN_COUNT = 2000
const NO_MORE = { hasMore: false, onLoadMore: () => {} }

const runs: RunSummary[] = Array.from({ length: RUN_COUNT }, (_, index) => ({
  id: `run-${index}`,
  workflow: { id: 'workflow-1', name: `Workflow ${index}` },
  status: 'completed',
  trigger: { label: 'Manual' },
  startedAt: 1_700_000_000_000 - index * 1000,
  durationMs: 1200,
  cu: 3,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  stubResizeObserver()
  // jsdom lays nothing out; a mounted row measures as a real 40px run row does.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.tagName === 'LI' ? 40 : 0
  })
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  window.history.replaceState(null, '', '/workspace/ws-1/logs')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function page(children: ReactNode) {
  return (
    <NuqsTestingAdapter>
      <SurfaceScopeProvider routePrefix=''>
        <WorkspaceSession mode='fixture'>{children}</WorkspaceSession>
      </SurfaceScopeProvider>
    </NuqsTestingAdapter>
  )
}

function list() {
  return (
    <RunList
      workspace={{ id: 'ws-1', name: 'Workspace' }}
      referenceTime={1_700_000_000_000}
      runs={runs}
      triggers={[]}
      workflows={[]}
      more={NO_MORE}
    />
  )
}

function mountedRuns() {
  return container.querySelectorAll('ol[aria-label="Runs"] a[href]')
}

it('mounts only a window of rows for a long list', () => {
  act(() => root.render(page(list())))

  const mounted = mountedRuns()
  expect(mounted.length).toBeGreaterThan(0)
  expect(mounted.length).toBeLessThan(100)
  expect(mounted[0]?.getAttribute('href')).toContain('run-0')
})

it('keeps the run stepped to in its details mounted for the returning list', () => {
  let revealOnReturn: ((recordId: string) => void) | undefined
  function Details() {
    revealOnReturn = useRevealOnReturn()
    return null
  }
  act(() => root.render(page(<Details />)))
  window.history.replaceState(null, '', '/workspace/ws-1/logs/run-1500')
  act(() => revealOnReturn?.('run-1500'))
  window.history.replaceState(null, '', '/workspace/ws-1/logs')

  act(() => root.render(page(list())))

  const hrefs = Array.from(mountedRuns(), (link) => link.getAttribute('href') ?? '')
  expect(hrefs.some((href) => href.includes('/run-1500'))).toBe(true)
  expect(hrefs.length).toBeLessThan(100)
})
