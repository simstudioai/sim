'use client'

import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  TabStrip,
  TabStripAction,
  type TabStripItem,
  Tooltip,
} from '@sim/emcn'
import { Download, Globe, Link, MoreHorizontal, Send, TerminalWindow, Trash } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import {
  ChatResourcePanel,
  type PanelView,
} from '@/app/playground/org/components/chat-resource-panel'
import { type ChatMessage, ChatThread } from '@/app/playground/org/components/chat-thread'
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

/** A tab that is still browsing; opening something turns it into that thing's tab. */
interface NewTab {
  kind: 'new'
  id: string
  workspaceId: string | null
  browseKind: PanelKind | null
}

interface BrowserTab {
  kind: 'browser'
  id: string
}

interface TerminalTab {
  kind: 'terminal'
  id: string
}

type PanelTab = PanelResource | NewTab | BrowserTab | TerminalTab

function tabKey(tab: PanelTab): string {
  return tab.kind === 'new' || tab.kind === 'browser' || tab.kind === 'terminal'
    ? `${tab.kind}:${tab.id}`
    : panelResourceKey(tab)
}

function newTab(workspaceId: string | null = null, browseKind: PanelKind | null = null): NewTab {
  return { kind: 'new', id: generateShortId(8), workspaceId, browseKind }
}

function stripItem(tab: PanelTab, active: boolean): TabStripItem {
  const id = tabKey(tab)
  switch (tab.kind) {
    case 'new':
      return { id, title: 'New tab', active }
    case 'browser':
      return { id, title: 'New Tab', icon: <Globe className={RESOURCE_TAB_ICON_CLASS} />, active }
    case 'terminal':
      return {
        id,
        title: 'Terminal',
        icon: <TerminalWindow className={RESOURCE_TAB_ICON_CLASS} />,
        active,
      }
    default: {
      const Icon = panelKindConfig(tab.kind).icon
      return { id, title: tab.name, icon: <Icon className={RESOURCE_TAB_ICON_CLASS} />, active }
    }
  }
}

const noop = () => {}

const NO_MESSAGES: ChatMessage[] = []

const SEED: ChatMessage[] = [
  { role: 'user', text: 'Why does the bot give two different refund windows?' },
  {
    role: 'assistant',
    text: 'Billing policies has two Confluence pages that disagree. Refund policy (2024) was never archived when the 2026 one was published, so search returns both and the answer depends on which ranks higher that day. I drafted the archive edit and replayed the last 48 refund questions without the old page: every answer says 30 days for annual plans.',
  },
]

interface ChatSurfaceProps {
  chat: Chat
}

/** A chat with the resource panel on the right: real panel chrome, mock resources. */
export function ChatSurface({ chat }: ChatSurfaceProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [tabs, setTabs] = useState<PanelTab[]>(() => mentionedIn(chat.id))
  const [activeKey, setActiveKey] = useState<string | null>(() => {
    const first = mentionedIn(chat.id)[0]
    return first ? panelResourceKey(first) : null
  })

  const activeIndex = tabs.findIndex((tab) => tabKey(tab) === activeKey)
  const active = tabs[activeIndex]

  /** Puts `tab` where the browsing tab is, or at the end when the active tab is something else. */
  const place = (tab: PanelTab) => {
    setTabs((prev) =>
      active?.kind === 'new' ? prev.map((t, i) => (i === activeIndex ? tab : t)) : [...prev, tab]
    )
    setActiveKey(tabKey(tab))
    setCollapsed(false)
  }

  const open = (resource: PanelResource) => {
    const key = panelResourceKey(resource)
    if (tabs.some((tab) => tabKey(tab) === key)) {
      // Already open: the browsing tab that found it is spent.
      if (active?.kind === 'new') setTabs((prev) => prev.filter((_, i) => i !== activeIndex))
      setActiveKey(key)
      return
    }
    place(resource)
  }

  /** Browses in the active tab, turning an open resource back into a browsing tab. */
  const browse = (workspaceId: string | null, kind: PanelKind | null) => {
    const tab =
      active?.kind === 'new'
        ? { ...active, workspaceId, browseKind: kind }
        : newTab(workspaceId, kind)
    setTabs((prev) =>
      activeIndex >= 0 ? prev.map((t, i) => (i === activeIndex ? tab : t)) : [...prev, tab]
    )
    setActiveKey(tabKey(tab))
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

  const view: PanelView = !active
    ? { type: 'browse', workspaceId: null, kind: null }
    : active.kind === 'new'
      ? { type: 'browse', workspaceId: active.workspaceId, kind: active.browseKind }
      : active.kind === 'browser' || active.kind === 'terminal'
        ? { type: active.kind }
        : { type: 'resource', resource: active }

  return (
    <ChatPanelLayout
      panel={
        <ChatPanelContent collapsed={collapsed}>
          <TabStrip
            tabs={tabs.map((tab) => stripItem(tab, activeKey === tabKey(tab)))}
            variant='floating'
            className={RESOURCE_HEADER_CLASSES.stripGeometry}
            onSelect={setActiveKey}
            onClose={close}
            onNew={add}
            newTabLabel='New tab'
            endActions={
              view.type === 'resource' ? (
                <ResourceTabActions resource={view.resource} onBrowse={browse} />
              ) : view.type === 'browser' ? (
                <IconAction label='Copy Link' icon={Link} />
              ) : null
            }
          />
          <ChatResourcePanel
            chatId={chat.id}
            view={view}
            onOpen={open}
            onOpenBrowser={() => place({ kind: 'browser', id: generateShortId(8) })}
            onOpenTerminal={() => place({ kind: 'terminal', id: generateShortId(8) })}
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
          <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-small'>
            {chat.title}
          </span>
          {chat.id === 'c15' && <RunningDot />}
        </header>
        <ChatThread
          placeholder={chat.id === 'new' ? 'Do anything' : 'Reply to Sim…'}
          seed={chat.id === 'c15' ? SEED : chat.id === 'new' ? NO_MESSAGES : undefined}
          className='mx-auto w-full max-w-[760px]'
        />
      </div>
    </ChatPanelLayout>
  )
}

interface IconActionProps {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick?: () => void
}

/** One of the active tab's actions, trailing the strip like the home panel's. */
function IconAction({ label, icon: Icon, onClick }: IconActionProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <TabStripAction variant='subtle' aria-label={label} onClick={onClick}>
          <Icon className={RESOURCE_TAB_ICON_CLASS} />
        </TabStripAction>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>{label}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

interface ResourceTabActionsProps {
  resource: PanelResource
  onBrowse: (workspaceId: string | null, kind: PanelKind | null) => void
}

/** The open resource's actions, with the path it came from behind the overflow menu. */
function ResourceTabActions({ resource, onBrowse }: ResourceTabActionsProps) {
  const config = panelKindConfig(resource.kind)
  const workspace = workspaceById(resource.workspaceId)
  return (
    <>
      <IconAction label='Copy Link' icon={Link} />
      <IconAction label='Download' icon={Download} />
      <IconAction label='Share' icon={Send} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TabStripAction variant='subtle' aria-label='More'>
            <MoreHorizontal className={RESOURCE_TAB_ICON_CLASS} />
          </TabStripAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onSelect={() => onBrowse(resource.workspaceId, resource.kind)}>
            <config.icon className='size-[14px] text-[var(--text-icon)]' />
            Show in {config.label}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onBrowse(resource.workspaceId, null)}>
            Show in {workspace.name}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <Trash className='size-[14px] text-[var(--text-icon)]' />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
