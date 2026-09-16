import { beforeEach, describe, expect, it } from 'vitest'
import { buildResourceAttachments } from '@/lib/browser-agent/attachments'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

const DOCS_TAB: MothershipResource = { type: 'browser', id: '1', title: 'Docs' }
const DASHBOARD_TAB: MothershipResource = { type: 'browser', id: '2', title: 'Dashboard' }

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

  it('enriches every browser tab resource and marks only the selected tab active', () => {
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

    expect(
      buildResourceAttachments([DOCS_TAB, DASHBOARD_TAB], DASHBOARD_TAB.id, 'chat-test')
    ).toEqual([
      {
        type: 'browser',
        id: '1',
        title: 'Docs',
        active: false,
        url: 'https://docs.sim.ai',
      },
      {
        type: 'browser',
        id: '2',
        title: 'Dashboard',
        active: true,
        url: 'https://sim.ai/workspace',
      },
    ])
  })

  it('keeps a browser tab open rather than active when another resource is selected', () => {
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
        },
      ],
    })

    const attachments = buildResourceAttachments([DOCS_TAB], 'workflow-1', 'chat-test')

    expect(attachments?.[0]).toMatchObject({ id: '1', active: false })
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
        },
      ],
    })

    const sameIdTab: MothershipResource = { type: 'browser', id: 'same-id', title: 'Tab' }
    expect(buildResourceAttachments([sameIdTab], sameIdTab.id, 'chat-a')?.[0]).toMatchObject({
      title: 'A',
      url: 'https://a.example',
    })
    expect(buildResourceAttachments([sameIdTab], sameIdTab.id, 'chat-b')?.[0]).toMatchObject({
      title: 'B',
      url: 'https://b.example',
    })
  })
})
