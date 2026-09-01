import { beforeEach, describe, expect, it } from 'vitest'
import { buildResourceAttachments } from '@/lib/browser-agent/attachments'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

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
      automationTabId: null,
      automationActive: false,
      automationNeedsAttention: false,
      agentRunIds: [],
      sessionAlive: true,
      suspended: false,
    }
    useBrowserSessionStore.setState({
      ...session,
      activeScopeId: 'chat-test',
      sessions: { 'chat-test': session },
    })
  })

  it('adds every live browser tab and marks only the selected tab active', () => {
    const store = useBrowserSessionStore.getState()
    store.setTabsState({
      scopeId: 'chat-test',
      activeTabId: '2',
      tabs: [
        {
          tabId: '1',
          title: 'Docs',
          url: 'https://docs.sim.ai',
          loading: false,
          active: false,
          pinned: false,
        },
        {
          tabId: '2',
          title: 'Dashboard',
          url: 'https://sim.ai/workspace',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })

    expect(buildResourceAttachments([BROWSER_RESOURCE], BROWSER_RESOURCE.id, 'chat-test')).toEqual([
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
    store.setTabsState({
      scopeId: 'chat-test',
      activeTabId: '1',
      tabs: [
        {
          tabId: '1',
          title: 'Docs',
          url: 'https://docs.sim.ai',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })

    const attachments = buildResourceAttachments([BROWSER_RESOURCE], 'workflow-1', 'chat-test')

    expect(attachments?.[0]).toMatchObject({ id: 'browser-session:1', active: false })
  })

  it('reads attachments only from the requested chat scope', () => {
    const store = useBrowserSessionStore.getState()
    store.setTabsState({
      scopeId: 'chat-a',
      activeTabId: 'same-id',
      tabs: [
        {
          tabId: 'same-id',
          title: 'A',
          url: 'https://a.example',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })
    store.setTabsState({
      scopeId: 'chat-b',
      activeTabId: 'same-id',
      tabs: [
        {
          tabId: 'same-id',
          title: 'B',
          url: 'https://b.example',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })

    expect(
      buildResourceAttachments([BROWSER_RESOURCE], BROWSER_RESOURCE.id, 'chat-a')?.[0]
    ).toMatchObject({ title: 'A', url: 'https://a.example' })
    expect(
      buildResourceAttachments([BROWSER_RESOURCE], BROWSER_RESOURCE.id, 'chat-b')?.[0]
    ).toMatchObject({ title: 'B', url: 'https://b.example' })
  })
})
