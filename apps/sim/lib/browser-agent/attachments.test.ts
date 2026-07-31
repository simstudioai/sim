import { beforeEach, describe, expect, it } from 'vitest'
import { buildResourceAttachments } from '@/lib/browser-agent/attachments'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import { LEGACY_BROWSER_SCOPE, useBrowserSessionStore } from '@/stores/browser-session/store'

const BROWSER_RESOURCE: MothershipResource = {
  type: 'browser',
  id: 'browser-session',
  title: 'Browser',
}

describe('buildResourceAttachments', () => {
  beforeEach(() => {
    const session = {
      pageState: null,
      tabs: [],
      activeTabId: null,
      tabsSupported: false,
      panelSnapshot: null,
      sessionAlive: true,
    }
    useBrowserSessionStore.setState({
      ...session,
      activeScopeId: LEGACY_BROWSER_SCOPE,
      sessions: { [LEGACY_BROWSER_SCOPE]: session },
    })
  })

  it('adds every live browser tab and marks only the selected tab active', () => {
    const store = useBrowserSessionStore.getState()
    store.setTabsSupported(true)
    store.setTabsState({
      activeTabId: '2',
      tabs: [
        {
          tabId: '1',
          title: 'Docs',
          url: 'https://docs.sim.ai',
          loading: false,
          active: false,
        },
        {
          tabId: '2',
          title: 'Dashboard',
          url: 'https://sim.ai/workspace',
          loading: false,
          active: true,
        },
      ],
    })

    expect(buildResourceAttachments([BROWSER_RESOURCE], BROWSER_RESOURCE.id)).toEqual([
      {
        type: 'browser',
        id: 'browser-session:1',
        title: 'Docs',
        active: false,
        url: 'https://docs.sim.ai',
      },
      {
        type: 'browser',
        id: 'browser-session:2',
        title: 'Dashboard',
        active: true,
        url: 'https://sim.ai/workspace',
      },
    ])
  })

  it('keeps all browser tabs open rather than active when another resource is selected', () => {
    const store = useBrowserSessionStore.getState()
    store.setTabsSupported(true)
    store.setTabsState({
      activeTabId: '1',
      tabs: [
        {
          tabId: '1',
          title: 'Docs',
          url: 'https://docs.sim.ai',
          loading: false,
          active: true,
        },
      ],
    })

    const attachments = buildResourceAttachments([BROWSER_RESOURCE], 'workflow-1')

    expect(attachments?.[0]).toMatchObject({ id: 'browser-session:1', active: false })
  })

  it('falls back to the active page for older single-tab desktop versions', () => {
    useBrowserSessionStore.getState().setPageState({
      url: 'https://sim.ai',
      title: 'Sim',
      loading: false,
      canGoBack: false,
      canGoForward: false,
    })

    expect(buildResourceAttachments([BROWSER_RESOURCE], BROWSER_RESOURCE.id)).toEqual([
      {
        type: 'browser',
        id: 'browser-session',
        title: 'Sim',
        active: true,
        url: 'https://sim.ai',
      },
    ])
  })

  it('reads attachments only from the requested chat scope', () => {
    const store = useBrowserSessionStore.getState()
    store.setTabsSupported(true, 'chat-a')
    store.setTabsState(
      {
        scopeId: 'chat-a',
        activeTabId: 'same-id',
        tabs: [
          {
            tabId: 'same-id',
            title: 'A',
            url: 'https://a.example',
            loading: false,
            active: true,
          },
        ],
      },
      'chat-a'
    )
    store.setTabsSupported(true, 'chat-b')
    store.setTabsState(
      {
        scopeId: 'chat-b',
        activeTabId: 'same-id',
        tabs: [
          {
            tabId: 'same-id',
            title: 'B',
            url: 'https://b.example',
            loading: false,
            active: true,
          },
        ],
      },
      'chat-b'
    )

    expect(
      buildResourceAttachments([BROWSER_RESOURCE], BROWSER_RESOURCE.id, 'chat-a')?.[0]
    ).toMatchObject({ title: 'A', url: 'https://a.example' })
    expect(
      buildResourceAttachments([BROWSER_RESOURCE], BROWSER_RESOURCE.id, 'chat-b')?.[0]
    ).toMatchObject({ title: 'B', url: 'https://b.example' })
  })
})
