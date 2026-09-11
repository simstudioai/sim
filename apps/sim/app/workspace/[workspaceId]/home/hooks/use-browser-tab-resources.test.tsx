/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import { useBrowserTabResources } from '@/app/workspace/[workspaceId]/home/hooks/use-browser-tab-resources'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

const { sendBrowserPanelAction, openUrlInNewBrowserTab, openInPanelListeners } = vi.hoisted(() => ({
  sendBrowserPanelAction: vi.fn(),
  openUrlInNewBrowserTab: vi.fn(),
  openInPanelListeners: new Set<(url: string) => void>(),
}))

vi.mock('@/lib/browser-agent/transport', () => ({
  sendBrowserPanelAction,
  openUrlInNewBrowserTab,
}))
vi.mock('@/lib/browser-agent/open-in-panel', () => ({
  onOpenInBrowserPanel: (listener: (url: string) => void) => {
    openInPanelListeners.add(listener)
    return () => openInPanelListeners.delete(listener)
  },
}))

const SCOPE = 'chat-1'

function tab(tabId: string, active = false, title = `Page ${tabId}`) {
  return { tabId, url: `https://example.com/${tabId}`, title, loading: false, active }
}

function pushTabs(scopeId: string, tabs: ReturnType<typeof tab>[], activeTabId: string | null) {
  act(() => {
    useBrowserSessionStore.getState().setTabsState({ scopeId, tabs, activeTabId })
  })
}

interface HostProps {
  scopeId: string
  resources: MothershipResource[]
  activeResourceId: string | null
  addResource: (resource: MothershipResource) => void
  removeResource: (type: MothershipResource['type'], id: string) => void
  selectResource: (id: string) => void
  onResourceEvent: (id: string, options?: { activate?: boolean }) => void
}

function Host(props: HostProps) {
  useBrowserTabResources(props)
  return null
}

describe('useBrowserTabResources', () => {
  let root: Root
  let container: HTMLDivElement
  const addResource = vi.fn()
  const removeResource = vi.fn()
  const selectResource = vi.fn()
  const onResourceEvent = vi.fn()

  function render(overrides: Partial<HostProps> = {}) {
    const props: HostProps = {
      scopeId: SCOPE,
      resources: [],
      activeResourceId: null,
      addResource,
      removeResource,
      selectResource,
      onResourceEvent,
      ...overrides,
    }
    act(() => root.render(<Host {...props} />))
    return (next: Partial<HostProps>) => act(() => root.render(<Host {...props} {...next} />))
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.clearAllMocks()
    openInPanelListeners.clear()
    useBrowserSessionStore.setState({ activeScopeId: SCOPE, sessions: {} })
    act(() => useBrowserSessionStore.getState().activateScope(SCOPE))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('projects each native page into a browser resource and removes closed pages', () => {
    const rerender = render()
    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')

    expect(addResource.mock.calls.map(([resource]) => resource)).toEqual([
      { type: 'browser', id: '1', title: 'Page 1' },
      { type: 'browser', id: '2', title: 'Page 2' },
    ])

    rerender({
      resources: [
        { type: 'browser', id: '1', title: 'Page 1' },
        { type: 'browser', id: '2', title: 'Page 2' },
      ],
    })
    pushTabs(SCOPE, [tab('1', true)], '1')
    expect(removeResource).toHaveBeenCalledExactlyOnceWith('browser', '2')
  })

  it('keeps projecting a tab until its resource lands, then treats absence as a close', () => {
    const rerender = render()
    pushTabs(SCOPE, [tab('1', true)], '1')
    expect(addResource).toHaveBeenCalledTimes(1)

    // Chat hydration replaced the list before the add committed: project again.
    rerender({ resources: [{ type: 'file', id: 'f', title: 'notes.md' }] })
    expect(addResource).toHaveBeenCalledTimes(2)

    rerender({
      resources: [
        { type: 'file', id: 'f', title: 'notes.md' },
        { type: 'browser', id: '1', title: 'Page 1' },
      ],
    })
    addResource.mockClear()

    // The user closed the strip tab; the native close has not landed yet.
    rerender({ resources: [{ type: 'file', id: 'f', title: 'notes.md' }] })
    expect(addResource).not.toHaveBeenCalled()
  })

  it('keeps the tabs through a pending-to-durable scope migration', () => {
    const resources: MothershipResource[] = [{ type: 'browser', id: '1', title: 'Page 1' }]
    const rerender = render({ scopeId: 'pending:new', resources })
    act(() => useBrowserSessionStore.getState().activateScope('pending:new'))
    pushTabs('pending:new', [tab('1', true)], '1')

    // The store migrates first; the hook still points at the pending scope.
    act(() => useBrowserSessionStore.getState().migrateScope('pending:new', SCOPE))
    expect(removeResource).not.toHaveBeenCalled()

    rerender({ scopeId: SCOPE, resources })
    expect(removeResource).not.toHaveBeenCalled()
    expect(addResource).not.toHaveBeenCalled()
  })

  it('switches the native page when a browser tab is selected, without claiming it', () => {
    const resources: MothershipResource[] = [
      { type: 'browser', id: '1', title: 'Page 1' },
      { type: 'browser', id: '2', title: 'Page 2' },
    ]
    const rerender = render({ resources, activeResourceId: '1' })
    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')
    expect(sendBrowserPanelAction).not.toHaveBeenCalled()

    rerender({ activeResourceId: '2' })
    expect(sendBrowserPanelAction).toHaveBeenCalledExactlyOnceWith(
      'switch-tab',
      { tabId: '2', claim: false },
      SCOPE
    )

    // The requested switch landing is not a native change to follow.
    pushTabs(SCOPE, [tab('1'), tab('2', true)], '2')
    expect(selectResource).not.toHaveBeenCalled()
  })

  it('follows a native switch into the strip only while the user is on the browser', () => {
    const resources: MothershipResource[] = [
      { type: 'browser', id: '1', title: 'Page 1' },
      { type: 'browser', id: '2', title: 'Page 2' },
      { type: 'file', id: 'f', title: 'notes.md' },
    ]
    const rerender = render({ resources, activeResourceId: '1' })
    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')

    pushTabs(SCOPE, [tab('1'), tab('2', true)], '2')
    expect(selectResource).toHaveBeenCalledExactlyOnceWith('2')
    expect(sendBrowserPanelAction).not.toHaveBeenCalled()

    selectResource.mockClear()
    rerender({ activeResourceId: 'f' })
    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')
    expect(selectResource).not.toHaveBeenCalled()
  })

  it('announces the agent tab as activity without moving the native page', () => {
    render({
      resources: [{ type: 'browser', id: '1', title: 'Page 1' }],
      activeResourceId: '1',
    })
    pushTabs(SCOPE, [tab('1', true)], '1')
    act(() => {
      useBrowserSessionStore.getState().setTabsState({
        scopeId: SCOPE,
        tabs: [tab('1', true), tab('2')],
        activeTabId: '1',
        automationTabId: '2',
        automationActive: true,
      })
    })

    expect(onResourceEvent).toHaveBeenCalledExactlyOnceWith('2', { activate: true })
    expect(sendBrowserPanelAction).not.toHaveBeenCalled()
  })

  it('selects a chat link tab as the user own choice', async () => {
    render()
    openUrlInNewBrowserTab.mockResolvedValue('9')

    await act(async () => {
      for (const listener of openInPanelListeners) listener('https://docs.sim.ai')
    })

    expect(openUrlInNewBrowserTab).toHaveBeenCalledWith('https://docs.sim.ai', SCOPE)
    expect(selectResource).toHaveBeenCalledExactlyOnceWith('9')
  })
})
