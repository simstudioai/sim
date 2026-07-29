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
    useBrowserSessionStore.setState({
      pageState: null,
      tabs: [],
      activeTabId: null,
      tabsSupported: false,
      panelSnapshot: null,
      sessionAlive: true,
    })
  })

  it('adds every live browser tab and marks only the selected tab active', () => {
    useBrowserSessionStore.setState({
      tabsSupported: true,
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
    useBrowserSessionStore.setState({
      tabsSupported: true,
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
    useBrowserSessionStore.setState({
      pageState: {
        url: 'https://sim.ai',
        title: 'Sim',
        loading: false,
        canGoBack: false,
        canGoForward: false,
      },
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
})
