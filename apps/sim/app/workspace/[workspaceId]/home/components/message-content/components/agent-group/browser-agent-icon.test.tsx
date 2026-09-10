/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import {
  BrowserAgentIcon,
  getBrowserAgentHostname,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/browser-agent-icon'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'

function tool(overrides: Partial<ToolCallData> = {}): AgentGroupItem {
  return {
    type: 'tool',
    data: {
      id: 'browser-tool',
      toolName: 'browser_navigate',
      displayTitle: 'Opening page',
      status: 'success',
      result: { success: true, output: { url: 'https://example.com/document' } },
      ...overrides,
    },
  }
}

describe('getBrowserAgentHostname', () => {
  it('uses the pending destination, then the observed redirect, and retains it during editing', () => {
    const navigating = tool({
      status: 'executing',
      params: { url: 'https://example.org/start' },
      result: undefined,
    })
    expect(getBrowserAgentHostname([tool(), navigating])).toBe('example.org')
    const redirected = tool({ params: { url: 'https://example.org/start' } })
    expect(getBrowserAgentHostname([redirected])).toBe('example.com')
    expect(
      getBrowserAgentHostname([
        redirected,
        tool({ toolName: 'browser_type', status: 'executing', result: undefined }),
      ])
    ).toBe('example.com')
  })

  it.each(['error', 'cancelled', 'rejected', 'awaiting_approval'] as const)(
    'does not adopt a destination from a %s tool',
    (status) => {
      expect(
        getBrowserAgentHostname([
          tool(),
          tool({ status, params: { url: 'https://example.org' }, result: undefined }),
        ])
      ).toBe('example.com')
    }
  )

  it.each(['', 'about:blank', 'file:///document', 'data:text/html,hello', 'not a URL'])(
    'clears the previous site for a page without an HTTP hostname: %s',
    (url) => {
      expect(
        getBrowserAgentHostname([
          tool(),
          tool({ toolName: 'browser_switch_tab', result: { success: true, output: { url } } }),
        ])
      ).toBeNull()
    }
  )

  it.each(['browser_open_tab', 'browser_switch_tab', 'browser_close_tab', 'browser_go_back'])(
    'clears an obsolete site while %s has no known destination',
    (toolName) => {
      expect(
        getBrowserAgentHostname([
          tool(),
          tool({ toolName, status: 'executing', result: undefined }),
        ])
      ).toBeNull()
    }
  )

  it('uses the agent tab from a tab list, including legacy results', () => {
    const tabs = [
      { tabId: 'visible', url: 'https://example.org' },
      { tabId: 'agent', url: 'https://example.com' },
    ]
    for (const output of [
      { tabs, activeTabId: 'visible', automationTabId: 'agent' },
      { tabs, activeTabId: 'agent' },
    ]) {
      expect(
        getBrowserAgentHostname([
          tool({ toolName: 'browser_list_tabs', result: { success: true, output } }),
        ])
      ).toBe('example.com')
    }
    expect(
      getBrowserAgentHostname([
        tool(),
        tool({
          toolName: 'browser_list_tabs',
          result: {
            success: true,
            output: { tabs, activeTabId: 'visible', automationTabId: null },
          },
        }),
      ])
    ).toBeNull()
  })

  it('follows a click into a new tab and screenshot page metadata', () => {
    for (const [toolName, output] of [
      [
        'browser_click',
        { activeTab: { url: 'https://example.org' }, effect: { tabChanged: true } },
      ],
      ['browser_screenshot', { viewport: { url: 'https://example.org' } }],
      ['browser_extract', { page: { url: 'https://example.org' } }],
    ] as const) {
      expect(
        getBrowserAgentHostname([tool(), tool({ toolName, result: { success: true, output } })])
      ).toBe('example.org')
    }
  })

  it('clears a stale site when an action navigated without reporting its destination', () => {
    expect(
      getBrowserAgentHostname([
        tool(),
        tool({
          toolName: 'browser_click',
          result: { success: true, output: { effect: { urlChanged: true } } },
        }),
      ])
    ).toBeNull()
  })

  it('ignores URLs from other tools and nested agent runs', () => {
    expect(
      getBrowserAgentHostname([
        tool(),
        tool({
          toolName: 'browser_read_text',
          params: { elementId: 4 },
          result: { success: true, output: { url: 'https://example.org/embedded' } },
        }),
        tool({
          toolName: 'web_search',
          result: { success: true, output: { url: 'https://example.org' } },
        }),
        {
          type: 'agent_group',
          group: {
            id: 'other-run',
            agentName: 'browser',
            agentLabel: 'Browser',
            isOpen: true,
            isDelegating: true,
            items: [tool({ result: { success: true, output: { url: 'https://example.org' } } })],
          },
        },
      ])
    ).toBe('example.com')
  })
})

describe('BrowserAgentIcon', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(() => act(() => root.unmount()))

  const render = (url: string) => {
    act(() =>
      root.render(
        <BrowserAgentIcon items={[tool({ result: { success: true, output: { url } } })]} />
      )
    )
  }

  it('keeps the globe until load and resets image state when the hostname changes', () => {
    render('https://example.com/document?token=private#section')
    const firstImage = container.querySelector('img')!
    expect(firstImage.src).toBe('https://www.google.com/s2/favicons?domain=example.com&sz=32')
    expect(container.querySelector('svg')).not.toBeNull()
    act(() => firstImage.dispatchEvent(new Event('load')))
    expect(container.querySelector('svg')).toBeNull()

    render('https://example.com/another-document')
    expect(container.querySelector('img')).toBe(firstImage)
    expect(container.querySelector('svg')).toBeNull()

    render('https://example.org/document')
    expect(container.querySelector('img')).not.toBe(firstImage)
    expect(container.querySelector('svg')).not.toBeNull()
    act(() => firstImage.dispatchEvent(new Event('error')))
    expect(container.querySelector('img')).not.toBeNull()
    act(() => container.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()

    render('https://example.com')
    expect(container.querySelector('img')).not.toBeNull()
    render('about:blank')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
