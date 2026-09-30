'use client'

import { useState } from 'react'
import { Avatar, TabStrip, type TabStripItem } from '@sim/emcn'
import { generateShortId } from '@sim/utils/id'
import { ChatResourcePanel } from '@/app/playground/org/components/chat-resource-panel'
import { ChatThread } from '@/app/playground/org/components/chat-thread'
import { RunningDot } from '@/app/playground/org/components/glyphs'
import {
  mentionedIn,
  type PanelKind,
  type PanelResource,
  panelKindConfig,
  panelResourceKey,
} from '@/app/playground/org/lib/chat-resources'
import { type Chat, workspaceById } from '@/app/playground/org/lib/mock-data'
import {
  ChatPanelContent,
  ChatPanelLayout,
} from '@/app/workspace/[workspaceId]/home/components/chat-panel-layout'
import {
  RESOURCE_HEADER_CLASSES,
  RESOURCE_TAB_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'

/** A tab that is still browsing; opening a resource turns it into that resource's tab. */
interface NewTab {
  kind: 'new'
  id: string
  browseKind: PanelKind | null
}

type PanelTab = PanelResource | NewTab

function tabKey(tab: PanelTab): string {
  return tab.kind === 'new' ? `new:${tab.id}` : panelResourceKey(tab)
}

function newTab(browseKind: PanelKind | null = null): NewTab {
  return { kind: 'new', id: generateShortId(8), browseKind }
}

const noop = () => {}

const SEED = [
  { role: 'user' as const, text: 'Why does the bot give two different refund windows?' },
  {
    role: 'assistant' as const,
    text: 'Billing policies has two Confluence pages that disagree. Refund policy (2024) was never archived when the 2026 one was published, so search returns both and the answer depends on which ranks higher that day. I drafted the archive edit and replayed the last 48 refund questions without the old page: every answer says 30 days for annual plans.',
  },
]

interface ChatSurfaceProps {
  chat: Chat
}

/** A chat with the resource panel on the right: real panel chrome, mock resources. */
export function ChatSurface({ chat }: ChatSurfaceProps) {
  const workspace = chat.workspaceId ? workspaceById(chat.workspaceId) : undefined
  const [collapsed, setCollapsed] = useState(false)
  const [tabs, setTabs] = useState<PanelTab[]>(() => mentionedIn(chat.id))
  const [activeKey, setActiveKey] = useState<string | null>(() => {
    const first = mentionedIn(chat.id)[0]
    return first ? panelResourceKey(first) : null
  })

  const activeIndex = tabs.findIndex((tab) => tabKey(tab) === activeKey)
  const active = tabs[activeIndex]

  /** Puts `tab` where the active tab is, or at the end when nothing is active. */
  const replaceActive = (tab: PanelTab) => {
    setTabs((prev) =>
      activeIndex >= 0 ? prev.map((t, i) => (i === activeIndex ? tab : t)) : [...prev, tab]
    )
    setActiveKey(tabKey(tab))
  }

  const open = (resource: PanelResource) => {
    const key = panelResourceKey(resource)
    const existing = tabs.findIndex((tab) => tabKey(tab) === key)
    if (existing >= 0) {
      // Already open: the browsing tab that found it is spent.
      if (active?.kind === 'new') setTabs((prev) => prev.filter((_, i) => i !== activeIndex))
      setActiveKey(key)
    } else if (active?.kind === 'new') {
      replaceActive(resource)
    } else {
      setTabs((prev) => [...prev, resource])
      setActiveKey(key)
    }
    setCollapsed(false)
  }

  const browse = (kind: PanelKind | null) => {
    if (active?.kind === 'new') replaceActive({ ...active, browseKind: kind })
    else replaceActive(newTab(kind))
  }

  const add = () => {
    const tab = newTab()
    setTabs((prev) => [...prev, tab])
    setActiveKey(tabKey(tab))
  }

  const close = (key: string) => {
    const index = tabs.findIndex((tab) => tabKey(tab) === key)
    const next = tabs.filter((tab) => tabKey(tab) !== key)
    setTabs(next)
    if (activeKey === key) {
      const neighbour = next[index] ?? next[index - 1]
      setActiveKey(neighbour ? tabKey(neighbour) : null)
    }
  }

  const stripTabs: TabStripItem[] = tabs.map((tab) => {
    if (tab.kind === 'new') {
      return { id: tabKey(tab), title: 'New tab', active: activeKey === tabKey(tab) }
    }
    const Icon = panelKindConfig(tab.kind).icon
    return {
      id: tabKey(tab),
      title: tab.name,
      icon: <Icon className={RESOURCE_TAB_ICON_CLASS} />,
      active: activeKey === tabKey(tab),
    }
  })

  return (
    <ChatPanelLayout
      panel={
        <ChatPanelContent collapsed={collapsed}>
          <TabStrip
            tabs={stripTabs}
            variant='floating'
            className={RESOURCE_HEADER_CLASSES.stripGeometry}
            onSelect={setActiveKey}
            onClose={close}
            onNew={add}
            newTabLabel='New tab'
          />
          <ChatResourcePanel
            chatId={chat.id}
            workspace={workspace}
            view={
              active && active.kind !== 'new'
                ? { type: 'resource', resource: active }
                : { type: 'browse', kind: active?.kind === 'new' ? active.browseKind : null }
            }
            onOpen={open}
            onBrowse={browse}
          />
        </ChatPanelContent>
      }
      collapsed={collapsed}
      label='resources'
      onToggle={() => setCollapsed((prev) => !prev)}
      onResize={noop}
      onResizeKeyDown={noop}
      onResizeFocus={noop}
    >
      <div className='flex min-w-0 flex-1 flex-col'>
        <header className='flex h-[calc(var(--resource-header-controls-height)+1px)] shrink-0 items-center gap-2 border-[var(--border)] border-b pr-[calc(var(--resource-header-end-inset)+var(--resource-header-toggle-hit-size))] pl-4'>
          {workspace && (
            <>
              <Avatar size='xs' name={workspace.name} />
              <span className='text-[var(--text-muted)] text-small'>{workspace.name}</span>
              <span className='text-[var(--text-muted)] text-small'>/</span>
            </>
          )}
          <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-small'>
            {chat.title}
          </span>
          {chat.id === 'c15' && <RunningDot />}
        </header>
        <ChatThread
          placeholder='Reply to Sim…'
          seed={chat.id === 'c15' ? SEED : undefined}
          className='mx-auto w-full max-w-[760px]'
        />
      </div>
    </ChatPanelLayout>
  )
}
