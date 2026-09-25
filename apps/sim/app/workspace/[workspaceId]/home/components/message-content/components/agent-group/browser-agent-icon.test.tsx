/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import {
  BrowserAgentIcon,
  getBrowserAgentFaviconUrl,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/browser-agent-icon'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

const { browserAvailable, chatIdentity } = vi.hoisted(() => ({
  browserAvailable: vi.fn(() => true),
  chatIdentity: { chatId: 'chat-1' },
}))
vi.mock('@/lib/browser-agent/transport', () => ({ isBrowserAgentAvailable: browserAvailable }))
vi.mock('@/app/workspace/[workspaceId]/home/components/chat-surface-context', () => ({
  useChatSurface: () => chatIdentity,
}))

function openPage(url: string, scopeId = 'chat-1', loading = false) {
  act(() =>
    useBrowserSessionStore.getState().setTabsState({
      scopeId,
      activeTabId: 'tab-1',
      automationTabId: 'tab-1',
      tabs: [{ tabId: 'tab-1', title: '', url, loading, active: true }],
    })
  )
}

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

describe('getBrowserAgentFaviconUrl', () => {
  it('keeps the observed origin and port without disclosing page details', () => {
    expect(
      getBrowserAgentFaviconUrl([
        tool({
          result: {
            success: true,
            output: {
              url: 'https://username:password@example.com:8443/document?token=private#part',
            },
          },
        }),
      ])
    ).toBe('https://example.com:8443/favicon.ico')
  })

  it('ignores URLs from other tools and nested agent runs', () => {
    expect(
      getBrowserAgentFaviconUrl([
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
    ).toBe('https://example.com/favicon.ico')
  })
})

describe('BrowserAgentIcon', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    browserAvailable.mockReturnValue(true)
    chatIdentity.chatId = 'chat-1'
    useBrowserSessionStore.setState({ sessions: {}, activeScopeId: null })
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

  it('does not contact sites from history, other chats, or pending navigation', () => {
    render('https://example.com/document')
    expect(container.querySelector('img')).toBeNull()
    openPage('https://example.com', 'another-chat')
    expect(container.querySelector('img')).toBeNull()
    openPage('https://example.com', 'chat-1', true)
    expect(container.querySelector('img')).toBeNull()
    openPage('https://example.org')
    expect(container.querySelector('img')).toBeNull()
    openPage('https://example.com')
    expect(container.querySelector('img')).not.toBeNull()
  })
})
