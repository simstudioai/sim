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

type HostProps = Parameters<typeof useBrowserTabResources>[0]

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
  const restoreResource = vi.fn()
  const onResourceEvent = vi.fn()

  function render(overrides: Partial<HostProps> = {}) {
    const props: HostProps = {
      scopeId: SCOPE,
      resources: [],
      activeResourceId: null,
      selectedResourceId: null,
      hydrated: true,
      addResource,
      removeResource,
      selectResource,
      restoreResource,
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
    const rerender = render({ resources, activeResourceId: '1', selectedResourceId: '1' })
    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')
    expect(sendBrowserPanelAction).not.toHaveBeenCalled()

    rerender({ activeResourceId: '2', selectedResourceId: '2' })
    expect(sendBrowserPanelAction).toHaveBeenCalledExactlyOnceWith(
      'switch-tab',
      { tabId: '2', claim: false },
      SCOPE
    )

    // The requested switch landing is not a native change to follow.
    pushTabs(SCOPE, [tab('1'), tab('2', true)], '2')
    expect(selectResource).not.toHaveBeenCalled()
  })

  it('adopts the native active page on reopen instead of pushing the fallback tab', () => {
    const resources: MothershipResource[] = [
      { type: 'browser', id: '1', title: 'Page 1' },
      { type: 'browser', id: '2', title: 'Page 2' },
      { type: 'browser', id: '3', title: 'Page 3' },
    ]
    // The user left this chat on page 2. On reopen the strip starts empty, the
    // pages land, and it falls back to its last tab until it learns better.
    const rerender = render()
    pushTabs(SCOPE, [tab('1'), tab('2', true), tab('3')], '2')
    rerender({ resources, activeResourceId: '3', selectedResourceId: null })

    expect(sendBrowserPanelAction).not.toHaveBeenCalled()
    expect(restoreResource).toHaveBeenCalledExactlyOnceWith('2')
    expect(selectResource).not.toHaveBeenCalled()

    // The adopted tab is now both the selection and the native page: settled.
    restoreResource.mockClear()
    rerender({ activeResourceId: '2', selectedResourceId: '2' })
    expect(restoreResource).not.toHaveBeenCalled()
    expect(sendBrowserPanelAction).not.toHaveBeenCalled()
  })

  it('adopts the native active page when the selection is stale', () => {
    const rerender = render({ selectedResourceId: 'deleted-file' })
    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')
    rerender({
      resources: [
        { type: 'browser', id: '1', title: 'Page 1' },
        { type: 'browser', id: '2', title: 'Page 2' },
      ],
      activeResourceId: '2',
    })

    expect(restoreResource).toHaveBeenCalledExactlyOnceWith('1')
    expect(sendBrowserPanelAction).not.toHaveBeenCalled()
  })

  it('leaves a fallback that is not a browser tab alone', () => {
    const rerender = render()
    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')
    rerender({
      resources: [
        { type: 'browser', id: '1', title: 'Page 1' },
        { type: 'file', id: 'f', title: 'notes.md' },
      ],
      activeResourceId: 'f',
      selectedResourceId: null,
    })

    expect(restoreResource).not.toHaveBeenCalled()
    expect(sendBrowserPanelAction).not.toHaveBeenCalled()
  })

  it('adopts the native active page only once the chat history has been applied', () => {
    const resources: MothershipResource[] = [
      { type: 'browser', id: '1', title: 'Page 1' },
      { type: 'browser', id: '2', title: 'Page 2' },
    ]
    const rerender = render({ hydrated: false })
    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')
    rerender({ resources, activeResourceId: '2', selectedResourceId: null, hydrated: false })
    expect(restoreResource).not.toHaveBeenCalled()

    rerender({ resources, activeResourceId: '2', selectedResourceId: null, hydrated: true })
    expect(restoreResource).toHaveBeenCalledExactlyOnceWith('1')
  })

  it('leaves a stored resource the history pinned alone once hydrated', () => {
    const rerender = render({ hydrated: false })
    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')
    rerender({
      resources: [
        { type: 'browser', id: '1', title: 'Page 1' },
        { type: 'browser', id: '2', title: 'Page 2' },
        { type: 'file', id: 'f', title: 'notes.md' },
      ],
      activeResourceId: 'f',
      selectedResourceId: 'f',
      hydrated: true,
    })
    expect(restoreResource).not.toHaveBeenCalled()
  })

  it('does not adopt a page the user just closed in the strip', () => {
    const rerender = render()
    pushTabs(SCOPE, [tab('1'), tab('2', true), tab('3')], '2')
    rerender({
      resources: [
        { type: 'browser', id: '1', title: 'Page 1' },
        { type: 'browser', id: '2', title: 'Page 2' },
        { type: 'browser', id: '3', title: 'Page 3' },
      ],
      activeResourceId: '2',
      selectedResourceId: '2',
    })
    expect(restoreResource).not.toHaveBeenCalled()

    // The strip dropped page 2 before the native close landed.
    rerender({
      resources: [
        { type: 'browser', id: '1', title: 'Page 1' },
        { type: 'browser', id: '3', title: 'Page 3' },
      ],
      activeResourceId: '3',
      selectedResourceId: null,
    })
    expect(restoreResource).not.toHaveBeenCalled()
    expect(sendBrowserPanelAction).not.toHaveBeenCalled()
  })

  it('adopts the first reported active page without claiming it', () => {
    const resources: MothershipResource[] = [
      { type: 'browser', id: '1', title: 'Page 1' },
      { type: 'browser', id: '2', title: 'Page 2' },
    ]
    const rerender = render()
    // The pages land before the desktop app reports which one it shows.
    pushTabs(SCOPE, [tab('1'), tab('2')], null)
    rerender({ resources, activeResourceId: '2', selectedResourceId: null })
    expect(restoreResource).not.toHaveBeenCalled()

    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')
    expect(restoreResource).toHaveBeenCalledExactlyOnceWith('1')
    expect(selectResource).not.toHaveBeenCalled()
    expect(sendBrowserPanelAction).not.toHaveBeenCalled()
  })

  it('claims a native switch away from a page it was already showing', () => {
    const resources: MothershipResource[] = [
      { type: 'browser', id: '1', title: 'Page 1' },
      { type: 'browser', id: '2', title: 'Page 2' },
    ]
    const rerender = render()
    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')
    rerender({ resources, activeResourceId: '1', selectedResourceId: null })
    expect(selectResource).not.toHaveBeenCalled()

    // A keyboard shortcut in the page moved the desktop app off page 1.
    pushTabs(SCOPE, [tab('1'), tab('2', true)], '2')
    expect(selectResource).toHaveBeenCalledExactlyOnceWith('2')
    expect(restoreResource).not.toHaveBeenCalled()
  })

  it('follows a native switch into the strip only while the user is on the browser', () => {
    const resources: MothershipResource[] = [
      { type: 'browser', id: '1', title: 'Page 1' },
      { type: 'browser', id: '2', title: 'Page 2' },
      { type: 'file', id: 'f', title: 'notes.md' },
    ]
    const rerender = render({ resources, activeResourceId: '1', selectedResourceId: '1' })
    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')

    pushTabs(SCOPE, [tab('1'), tab('2', true)], '2')
    expect(selectResource).toHaveBeenCalledExactlyOnceWith('2')
    expect(sendBrowserPanelAction).not.toHaveBeenCalled()

    selectResource.mockClear()
    rerender({ activeResourceId: 'f', selectedResourceId: 'f' })
    pushTabs(SCOPE, [tab('1', true), tab('2')], '1')
    expect(selectResource).not.toHaveBeenCalled()
  })

  it('announces the agent tab as activity without moving the native page', () => {
    render({
      resources: [{ type: 'browser', id: '1', title: 'Page 1' }],
      activeResourceId: '1',
      selectedResourceId: '1',
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
