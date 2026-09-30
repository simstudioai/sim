'use client'

import { useState } from 'react'
import { Avatar, TabStrip, type TabStripItem } from '@sim/emcn'
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

/** What the panel shows: the resource browser, or one open resource. */
export type PanelView =
  | { type: 'browse'; kind: PanelKind | null }
  | { type: 'resource'; key: string }

const BROWSE: PanelView = { type: 'browse', kind: null }

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
  const [tabs, setTabs] = useState<PanelResource[]>(() => mentionedIn(chat.id))
  const [view, setView] = useState<PanelView>(() => {
    const first = mentionedIn(chat.id)[0]
    return first ? { type: 'resource', key: panelResourceKey(first) } : BROWSE
  })

  const open = (resource: PanelResource) => {
    const key = panelResourceKey(resource)
    setTabs((prev) =>
      prev.some((tab) => panelResourceKey(tab) === key) ? prev : [...prev, resource]
    )
    setView({ type: 'resource', key })
    setCollapsed(false)
  }

  const close = (key: string) => {
    const index = tabs.findIndex((tab) => panelResourceKey(tab) === key)
    const next = tabs.filter((tab) => panelResourceKey(tab) !== key)
    setTabs(next)
    if (view.type === 'resource' && view.key === key) {
      const neighbour = next[index] ?? next[index - 1]
      setView(neighbour ? { type: 'resource', key: panelResourceKey(neighbour) } : BROWSE)
    }
  }

  const stripTabs: TabStripItem[] = tabs.map((tab) => {
    const Icon = panelKindConfig(tab.kind).icon
    return {
      id: panelResourceKey(tab),
      title: tab.name,
      icon: <Icon className={RESOURCE_TAB_ICON_CLASS} />,
      active: view.type === 'resource' && view.key === panelResourceKey(tab),
    }
  })

  const active =
    view.type === 'resource' ? tabs.find((tab) => panelResourceKey(tab) === view.key) : undefined

  return (
    <ChatPanelLayout
      panel={
        <ChatPanelContent collapsed={collapsed}>
          <TabStrip
            tabs={stripTabs}
            variant='floating'
            className={RESOURCE_HEADER_CLASSES.stripGeometry}
            onSelect={(id) => setView({ type: 'resource', key: id })}
            onClose={close}
            onNew={() => setView(BROWSE)}
            newTabLabel='Browse resources'
          />
          <ChatResourcePanel
            chatId={chat.id}
            workspace={workspace}
            view={
              active
                ? { type: 'resource', resource: active }
                : { type: 'browse', kind: view.type === 'browse' ? view.kind : null }
            }
            onOpen={open}
            onBrowse={(kind) => setView({ type: 'browse', kind })}
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
