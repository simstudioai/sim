/** @vitest-environment jsdom */
import { act, Suspense, useState } from 'react'
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkflowLoadingOverlay,
  WorkflowNavigationLink,
  WorkflowNavigationProvider,
} from '@/app/workspace/[workspaceId]/w/components/workflow-navigation'

const { router } = vi.hoisted(() => ({
  router: {
    route: '/workspace/workspace-1/w/workflow-a',
    pathname: '/workspace/workspace-1/w/workflow-a',
    asPath: '/workspace/workspace-1/w/workflow-a',
    query: {},
    basePath: '',
    isFallback: false,
    isReady: true,
    isPreview: false,
    isLocaleDomain: false,
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    beforePopState: vi.fn(),
    reload: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({ useRouter: () => router }))

const PATH_A = '/workspace/workspace-1/w/workflow-a'
const PATH_B = '/workspace/workspace-1/w/workflow-b'
const PATH_C = '/workspace/workspace-1/w/workflow-c'

interface PendingRoute {
  ready: boolean
  promise: Promise<void>
  resolve: () => void
}

function pendingRoute(): PendingRoute {
  let resolve!: () => void
  const route = {
    ready: false,
    promise: new Promise<void>((done) => {
      resolve = done
    }),
    resolve: () => {
      route.ready = true
      resolve()
    },
  }
  return route
}

interface DestinationProps {
  path: string
  embedded?: boolean
}

describe('workflow navigation feedback', () => {
  let container: HTMLDivElement
  let root: Root
  let routes: Map<string, PendingRoute>
  let hydrated: Set<string>
  let updatePath: (path: string) => void
  let rerenderDestination: () => void

  function Destination({ path, embedded }: DestinationProps) {
    const route = routes.get(path)
    if (route && !route.ready) throw route.promise
    return (
      <main data-route={path}>
        <WorkflowLoadingOverlay isLoading={!hydrated.has(path)} embedded={embedded} />
      </main>
    )
  }

  function Harness({ embedded = false }: { embedded?: boolean }) {
    const [path, setPath] = useState(PATH_A)
    const [, forceRender] = useState(0)
    updatePath = setPath
    rerenderDestination = () => forceRender((value) => value + 1)

    return (
      <RouterContext.Provider value={router}>
        <WorkflowNavigationProvider>
          <nav>
            <WorkflowNavigationLink href={PATH_A} prefetch={false}>
              A
            </WorkflowNavigationLink>
            <WorkflowNavigationLink href={PATH_B} prefetch={false}>
              B
            </WorkflowNavigationLink>
            <WorkflowNavigationLink href={PATH_C} prefetch={false}>
              C
            </WorkflowNavigationLink>
            <WorkflowNavigationLink href={PATH_B} prefetch={false} target='_blank'>
              New tab
            </WorkflowNavigationLink>
            <WorkflowNavigationLink
              href={PATH_B}
              prefetch={false}
              onClick={(event) => event.preventDefault()}
            >
              Cancelled click
            </WorkflowNavigationLink>
          </nav>
          <Suspense fallback={<div>Route fallback</div>}>
            <Destination path={path} embedded={embedded} />
          </Suspense>
        </WorkflowNavigationProvider>
      </RouterContext.Provider>
    )
  }

  function click(label: string, options: MouseEventInit = {}) {
    const link = Array.from(container.querySelectorAll('a')).find(
      (item) => item.textContent === label
    )
    if (!link) throw new Error(`Missing link: ${label}`)
    act(() =>
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options }))
    )
  }

  const preventBrowserNavigation = (event: Event) => event.preventDefault()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }))
    window.history.replaceState(null, '', PATH_A)
    routes = new Map([
      [PATH_B, pendingRoute()],
      [PATH_C, pendingRoute()],
    ])
    hydrated = new Set([PATH_A])
    router.push.mockImplementation((path: string) => updatePath(path))
    router.replace.mockImplementation((path: string) => updatePath(path))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    document.addEventListener('click', preventBrowserNavigation)
    act(() => root.render(<Harness />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.removeEventListener('click', preventBrowserNavigation)
    vi.unstubAllGlobals()
  })

  it('preserves replace navigation outside the workflow provider', () => {
    router.replace.mockImplementation(() => undefined)
    act(() =>
      root.render(
        <RouterContext.Provider value={router}>
          <WorkflowNavigationLink href={PATH_B} replace scroll={false}>
            Replace workflow
          </WorkflowNavigationLink>
        </RouterContext.Provider>
      )
    )
    click('Replace workflow')
    expect(router.replace).toHaveBeenCalledWith(PATH_B, {
      scroll: false,
      transitionTypes: undefined,
    })
    expect(router.push).not.toHaveBeenCalled()
  })

  it('shows the wordmark while the old route is still displayed and keeps it through hydration', async () => {
    expect(container.querySelector('[role="status"]')).toBeNull()
    click('B')
    expect(router.push).toHaveBeenCalledWith(PATH_B, expect.any(Object))
    expect(container.querySelector('main')?.dataset.route).toBe(PATH_A)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading workflow')
    expect(container.querySelector('[data-stage="wm"]')?.getAttribute('opacity')).toBe('1')

    await act(async () => routes.get(PATH_B)?.resolve())
    expect(container.querySelector('main')?.dataset.route).toBe(PATH_B)
    expect(container.querySelector('[role="status"]')).not.toBeNull()

    hydrated.add(PATH_B)
    act(() => rerenderDestination())
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('lets a newer destination complete without waiting for the abandoned route', async () => {
    click('B')
    click('C')
    hydrated.add(PATH_C)
    await act(async () => routes.get(PATH_C)?.resolve())
    expect(container.querySelector('main')?.dataset.route).toBe(PATH_C)
    expect(container.querySelector('[role="status"]')).toBeNull()

    await act(async () => routes.get(PATH_B)?.resolve())
    expect(container.querySelector('main')?.dataset.route).toBe(PATH_C)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('clears navigation feedback when switching back to the current workflow', () => {
    click('B')
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    click('A')
    expect(container.querySelector('main')?.dataset.route).toBe(PATH_A)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }])(
    'leaves modified clicks to the browser: %j',
    (options) => {
      click('B', options)
      expect(router.push).not.toHaveBeenCalled()
      expect(container.querySelector('[role="status"]')).toBeNull()
    }
  )

  it.each(['New tab', 'Cancelled click', 'A'])(
    'does not show navigation feedback for %s',
    (label) => {
      click(label)
      expect(container.querySelector('[role="status"]')).toBeNull()
      if (label !== 'A') expect(router.push).not.toHaveBeenCalled()
    }
  )

  it('does not cover embedded workflows when the main workspace navigates', () => {
    act(() => root.render(<Harness embedded />))
    click('B')
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})
