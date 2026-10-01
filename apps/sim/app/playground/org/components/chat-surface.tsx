'use client'

import { useEffect, useState } from 'react'
import {
  Chip,
  cn,
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
import {
  Check,
  ChevronDown,
  Download,
  Globe,
  Link,
  MoreHorizontal,
  Send,
  TerminalWindow,
  Trash,
} from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { useQueryStates } from 'nuqs'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import {
  ChatResourcePanel,
  type PanelView,
} from '@/app/playground/org/components/chat-resource-panel'
import { type ChatMessage, ChatThread } from '@/app/playground/org/components/chat-thread'
import { RunningDot } from '@/app/playground/org/components/glyphs'
import { HomeView } from '@/app/playground/org/components/home-view'
import {
  isPanelKind,
  mentionedIn,
  type PanelKind,
  type PanelResource,
  panelKindConfig,
  panelResourceKey,
  resolvePanelResource,
} from '@/app/playground/org/lib/chat-resources'
import { useProtoChats } from '@/app/playground/org/lib/chat-store'
import {
  type Chat,
  ORGANIZATION,
  WORKSPACES,
  workspaceById,
} from '@/app/playground/org/lib/mock-data'
import { type ProjectSection, WORKSPACE_SECTIONS } from '@/app/playground/org/lib/routes'
import { protoParsers } from '@/app/playground/org/lib/search-params'
import { useWorkspacePane } from '@/app/playground/org/lib/workspace-pane-store'
import {
  ChatPanelContent,
  ChatPanelLayout,
} from '@/app/workspace/[workspaceId]/home/components/chat-panel-layout'
import {
  RESOURCE_HEADER_CLASSES,
  RESOURCE_TAB_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import { useMothershipResize } from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-resize'

/** The pinned first tab: the project, shared by every chat. */
const WORKSPACE_TAB = 'workspace'

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

/** The tab a `?open=` ref names: `browse:workspace[:kind]` or `kind:workspace:id`. */
function tabFromRef(ref: string): PanelTab {
  if (!ref.startsWith('browse:')) return resolvePanelResource(ref)
  const [, workspaceId, kind] = ref.split(':')
  if (!workspaceId) throw new Error(`Bad browse ref ${ref}`)
  if (!kind) return newTab(workspaceId, null)
  if (!isPanelKind(kind)) throw new Error(`Bad browse ref ${ref}`)
  return newTab(workspaceId, kind)
}

function isProjectSection(value: string): value is ProjectSection {
  return value === 'resources' || WORKSPACE_SECTIONS.some((section) => section.id === value)
}

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
  /** A chat with no messages yet; its first message becomes its title. */
  fresh?: boolean
}

/** A chat on the left, the workspace pane on the right: real panel chrome, mock resources. */
export function ChatSurface({ chat, fresh = false }: ChatSurfaceProps) {
  const [{ open: openRef }, setParams] = useQueryStates(protoParsers)
  const renameChat = useProtoChats((state) => state.renameChat)
  const { projectId, setProject, setSection } = useWorkspacePane()
  const [collapsed, setCollapsed] = useState(false)
  const resize = useMothershipResize('playground')
  const [tabs, setTabs] = useState<PanelTab[]>(() => mentionedIn(chat.id))
  const [activeKey, setActiveKey] = useState<string>(() => {
    const first = mentionedIn(chat.id)[0]
    return first ? panelResourceKey(first) : WORKSPACE_TAB
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
      setCollapsed(false)
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

  /** A new tab starts on the project the pane is showing; Change browses the others. */
  const add = () => {
    const tab = newTab(projectId)
    setTabs((prev) => [...prev, tab])
    setActiveKey(tabKey(tab))
  }

  const close = (key: string) => {
    const index = tabs.findIndex((tab) => tabKey(tab) === key)
    const next = tabs.filter((tab) => tabKey(tab) !== key)
    setTabs(next)
    if (activeKey === key) {
      const neighbour = next[index] ?? next[index - 1]
      setActiveKey(neighbour ? tabKey(neighbour) : WORKSPACE_TAB)
    }
  }

  /**
   * A `?open=` link anywhere in the pane is read once and stripped: `workspace:id:section`
   * selects the project in the workspace tab, anything else opens as a resource tab.
   */
  useEffect(() => {
    if (!openRef) return
    if (openRef === 'workspace' || openRef.startsWith('workspace:')) {
      const [, workspaceId, section] = openRef.split(':')
      if (workspaceId && !WORKSPACES.some((w) => w.id === workspaceId))
        throw new Error(`Bad ref ${openRef}`)
      setProject(workspaceId || null)
      if (section) {
        if (!isProjectSection(section)) throw new Error(`Bad ref ${openRef}`)
        setSection(section)
      }
      setActiveKey(WORKSPACE_TAB)
      setCollapsed(false)
    } else {
      const tab = tabFromRef(openRef)
      if (tab.kind === 'new') place(tab)
      else if (tab.kind === 'browser' || tab.kind === 'terminal') place(tab)
      else open(tab)
    }
    void setParams({ open: null }, { history: 'replace', scroll: false })
    // Runs once per ref; the handlers read the tabs at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRef])

  const view: PanelView =
    activeKey === WORKSPACE_TAB || !active
      ? { type: 'workspace' }
      : active.kind === 'new'
        ? { type: 'browse', workspaceId: active.workspaceId, kind: active.browseKind }
        : active.kind === 'browser' || active.kind === 'terminal'
          ? { type: active.kind }
          : { type: 'resource', resource: active }

  const project = projectId ? workspaceById(projectId) : null
  const stripTabs: TabStripItem[] = tabs.map((tab) => stripItem(tab, activeKey === tabKey(tab)))
  /** Picking a project shows it in the workspace tab, like switching a browser profile. */
  const pickProject = (id: string | null) => {
    setProject(id)
    setActiveKey(WORKSPACE_TAB)
    setCollapsed(false)
  }

  return (
    <ChatPanelLayout
      panel={
        <ChatPanelContent ref={resize.mothershipRef} collapsed={collapsed}>
          <div className='flex min-w-0 items-center border-[var(--border)] border-b'>
            <div className='shrink-0 pl-[var(--resource-header-end-inset)]'>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Chip
                    variant='primary'
                    shape='round'
                    leftAdornment={<IdentityTile initial={(project ?? ORGANIZATION).name[0]} />}
                    rightIcon={ChevronDown}
                    aria-label='Switch project'
                  >
                    {project?.name ?? ORGANIZATION.name}
                  </Chip>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' className='w-[260px]'>
                  <DropdownMenuItem onSelect={() => pickProject(null)}>
                    <IdentityTile initial={ORGANIZATION.name[0]} />
                    <span className='min-w-0 flex-1 truncate'>{ORGANIZATION.name}</span>
                    <Check className={cn(project && 'invisible')} />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {WORKSPACES.map((candidate) => (
                    <DropdownMenuItem key={candidate.id} onSelect={() => pickProject(candidate.id)}>
                      <IdentityTile initial={candidate.name[0]} />
                      <span className='min-w-0 flex-1 truncate'>{candidate.name}</span>
                      <Check className={cn(candidate.id !== project?.id && 'invisible')} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <TabStrip
              tabs={stripTabs}
              variant='floating'
              dividers={false}
              className={cn(RESOURCE_HEADER_CLASSES.stripGeometry, 'min-w-0 flex-1')}
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
          </div>
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
      label='workspace'
      onToggle={() =>
        setCollapsed((prev) => {
          if (!prev) resize.clearWidth()
          return !prev
        })
      }
      onResize={resize.handleResizePointerDown}
      onResizeKeyDown={resize.handleResizeKeyDown}
      onResizeFocus={resize.handleResizeFocus}
    >
      <div className='flex min-w-0 flex-1 flex-col'>
        <header className='flex h-[calc(var(--resource-header-controls-height)+1px)] shrink-0 items-center gap-2 border-[var(--border)] border-b pr-[calc(var(--resource-header-end-inset)+var(--resource-header-toggle-hit-size))] pl-4'>
          <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-small'>
            {chat.title}
          </span>
          {chat.id === 'c15' && <RunningDot />}
        </header>
        {chat.id === 'new' ? (
          <HomeView />
        ) : (
          <ChatThread
            placeholder={fresh ? 'Do anything' : 'Reply to Sim…'}
            seed={fresh ? NO_MESSAGES : chat.id === 'c15' ? SEED : undefined}
            onSend={
              fresh && chat.title === 'New chat'
                ? (text) => renameChat(chat.id, truncate(text, 48))
                : undefined
            }
            className='mx-auto w-full max-w-[760px]'
          />
        )}
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
