'use client'

import { useState } from 'react'
import { Chip, ChipInput, cn } from '@sim/emcn'
import { Globe, Search, TerminalWindow } from '@sim/emcn/icons'
import { BrowseRow, BrowseSection } from '@/app/playground/org/components/browse-rows'
import { IssuePage } from '@/app/playground/org/components/issue-page'
import { ProtoDashboard } from '@/app/playground/org/components/proto-dashboard'
import { WorkspaceView } from '@/app/playground/org/components/workspace-view'
import {
  mentionedIn,
  PANEL_KINDS,
  type PanelKind,
  type PanelResource,
  panelKindConfig,
  panelResourceKey,
  resourcesOfKind,
} from '@/app/playground/org/lib/chat-resources'
import {
  issueByKey,
  ORGANIZATION,
  WORKSPACES,
  type Workspace,
  workspaceById,
} from '@/app/playground/org/lib/mock-data'
import {
  Resource,
  type ResourceColumn,
  type ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'

export type PanelView =
  | { type: 'workspace' }
  | { type: 'browse'; workspaceId: string | null; kind: PanelKind | null }
  | { type: 'resource'; resource: PanelResource }
  | { type: 'browser' }
  | { type: 'terminal' }

interface ChatResourcePanelProps {
  chatId: string
  view: PanelView
  onOpen: (resource: PanelResource) => void
  onOpenBrowser: () => void
  onOpenTerminal: () => void
  onBrowse: (workspaceId: string | null, kind: PanelKind | null) => void
}

/** Body of the resource panel: the new-tab browser, one open resource, a browser, or a terminal. */
export function ChatResourcePanel({
  chatId,
  view,
  onOpen,
  onOpenBrowser,
  onOpenTerminal,
  onBrowse,
}: ChatResourcePanelProps) {
  if (view.type === 'workspace') return <WorkspaceView onBrowse={onBrowse} />
  if (view.type === 'resource') return <ResourceBody resource={view.resource} />
  if (view.type === 'browser') return <BrowserView />
  if (view.type === 'terminal') return <TerminalView />

  const project = view.workspaceId ? WORKSPACES.find((w) => w.id === view.workspaceId) : undefined
  if (view.kind && project) {
    return (
      <KindList
        workspace={project}
        kind={view.kind}
        onOpen={onOpen}
        onBack={() => onBrowse(project.id, null)}
      />
    )
  }
  return (
    <BrowseView
      chatId={chatId}
      project={project}
      onOpen={onOpen}
      onOpenBrowser={onOpenBrowser}
      onOpenTerminal={onOpenTerminal}
      onBrowse={onBrowse}
    />
  )
}

interface BrowseViewProps {
  chatId: string
  project?: Workspace
  onOpen: (resource: PanelResource) => void
  onOpenBrowser: () => void
  onOpenTerminal: () => void
  onBrowse: (workspaceId: string | null, kind: PanelKind | null) => void
}

/** A browsing tab: search, what the chat mentioned, then the project's kinds. */
function BrowseView({
  chatId,
  project,
  onOpen,
  onOpenBrowser,
  onOpenTerminal,
  onBrowse,
}: BrowseViewProps) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const scope = project ? [project] : WORKSPACES
  const results = needle
    ? scope.flatMap((workspace) =>
        PANEL_KINDS.flatMap((kind) =>
          resourcesOfKind(workspace, kind.id).filter((resource) =>
            resource.name.toLowerCase().includes(needle)
          )
        )
      )
    : []
  return (
    <div className='min-h-0 flex-1 overflow-y-auto px-8 py-8'>
      <div className='mx-auto flex w-full max-w-[560px] flex-col gap-6'>
        <ChipInput
          icon={Search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${project?.name ?? ORGANIZATION.name}…`}
        />
        {needle ? (
          <BrowseSection label={results.length > 0 ? 'Results' : 'No results'}>
            {results.map((resource) => {
              const Icon = panelKindConfig(resource.kind).icon
              return (
                <BrowseRow key={panelResourceKey(resource)} onClick={() => onOpen(resource)}>
                  <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                  <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>
                    {resource.name}
                  </span>
                  <span className='text-[var(--text-muted)] text-caption'>
                    {project
                      ? panelKindConfig(resource.kind).label
                      : workspaceById(resource.workspaceId).name}
                  </span>
                </BrowseRow>
              )
            })}
          </BrowseSection>
        ) : (
          <>
            {mentionedIn(chatId).length > 0 && (
              <BrowseSection label='Mentioned in this chat'>
                {mentionedIn(chatId).map((resource) => {
                  const Icon = panelKindConfig(resource.kind).icon
                  return (
                    <BrowseRow key={panelResourceKey(resource)} onClick={() => onOpen(resource)}>
                      <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                      <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>
                        {resource.name}
                      </span>
                      {resource.status && (
                        <span className='text-[var(--text-muted)] text-caption'>
                          {resource.status}
                        </span>
                      )}
                    </BrowseRow>
                  )
                })}
              </BrowseSection>
            )}
            {project ? (
              <BrowseSection
                label={`Browse ${project.name}`}
                trailing={
                  <button
                    type='button'
                    onClick={() => onBrowse(null, null)}
                    className='text-[var(--text-muted)] text-caption hover-hover:text-[var(--text-body)]'
                  >
                    Change
                  </button>
                }
              >
                {PANEL_KINDS.map((kind) => (
                  <BrowseRow key={kind.id} onClick={() => onBrowse(project.id, kind.id)}>
                    <kind.icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                    <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>
                      {kind.label}
                    </span>
                    <span className='text-[var(--text-muted)] text-caption'>
                      {resourcesOfKind(project, kind.id).length}
                    </span>
                  </BrowseRow>
                ))}
                <BrowseRow onClick={onOpenBrowser}>
                  <Globe className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                  <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>Browser</span>
                </BrowseRow>
                <BrowseRow onClick={onOpenTerminal}>
                  <TerminalWindow className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                  <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>Terminal</span>
                </BrowseRow>
              </BrowseSection>
            ) : (
              <BrowseSection label={`Browse ${ORGANIZATION.name}`}>
                {WORKSPACES.map((candidate) => (
                  <BrowseRow key={candidate.id} onClick={() => onBrowse(candidate.id, null)}>
                    <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>
                      {candidate.name}
                    </span>
                  </BrowseRow>
                ))}
                <BrowseRow onClick={onOpenBrowser}>
                  <Globe className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                  <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>Browser</span>
                </BrowseRow>
                <BrowseRow onClick={onOpenTerminal}>
                  <TerminalWindow className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                  <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>Terminal</span>
                </BrowseRow>
              </BrowseSection>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const KIND_COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', widthMultiplier: 2 },
  { id: 'meta', header: 'Detail' },
]

interface KindListProps {
  workspace: Workspace
  kind: PanelKind
  onOpen: (resource: PanelResource) => void
  onBack: () => void
}

/** One resource family as the real list, inside the panel. */
function KindList({ workspace, kind, onOpen, onBack }: KindListProps) {
  const config = panelKindConfig(kind)
  const [search, setSearch] = useState('')
  const Icon = config.icon
  const items = resourcesOfKind(workspace, kind).filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  )
  const rows: ResourceRow[] = items.map((item) => ({
    id: panelResourceKey(item),
    cells: {
      name: { icon: <Icon className='size-[14px] text-[var(--text-icon)]' />, label: item.name },
      meta: { label: item.status ?? '' },
    },
  }))
  return (
    <Resource>
      <Resource.Header
        icon={Icon}
        breadcrumbs={[
          { label: workspace.name, onClick: onBack },
          { label: config.label, icon: Icon },
        ]}
      />
      <Resource.Options
        search={{
          value: search,
          onChange: setSearch,
          placeholder: `Search ${config.label.toLowerCase()}`,
        }}
      />
      <Resource.Table
        columns={KIND_COLUMNS}
        rows={rows}
        onRowClick={(id) => {
          const item = items.find((candidate) => panelResourceKey(candidate) === id)
          if (item) onOpen(item)
        }}
      />
    </Resource>
  )
}

/** An open resource's content; its name and actions live in the tab strip. */
function ResourceBody({ resource }: { resource: PanelResource }) {
  const workspace = workspaceById(resource.workspaceId)
  const issue = resource.kind === 'issues' ? issueByKey(resource.id) : undefined
  return (
    <div className='min-h-0 flex-1 overflow-y-auto'>
      {resource.kind === 'knowledge' && resource.id === 'refund-2024' ? (
        <RefundPolicyEdit />
      ) : issue ? (
        <IssuePage workspace={workspace} issue={issue} />
      ) : resource.kind === 'dashboard' ? (
        <ProtoDashboard workspace={workspace} />
      ) : (
        <p className='px-6 py-16 text-center text-[var(--text-muted)] text-small'>
          {resource.name} opens here.
        </p>
      )}
    </div>
  )
}

/** Stand-in for the desktop browser tab: an address bar over an empty page. */
function BrowserView() {
  const [url, setUrl] = useState('')
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='shrink-0 border-[var(--border)] border-b px-3 py-2'>
        <ChipInput
          icon={Globe}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder='Search or enter a URL'
        />
      </div>
      <div className='flex flex-1 items-center justify-center text-[var(--text-muted)] text-small'>
        Sim can browse here with you.
      </div>
    </div>
  )
}

/** Stand-in for the desktop terminal: a prompt in the org's directory. */
function TerminalView() {
  return (
    <div className='min-h-0 flex-1 overflow-y-auto bg-[var(--surface-1)] px-4 py-3 font-mono text-[var(--text-body)] text-caption'>
      <span className='text-[var(--text-muted)]'>~/{ORGANIZATION.id}</span> ${' '}
      <span className='animate-pulse'>▍</span>
    </div>
  )
}

const EDIT_LINES = [
  { kind: 'add', text: 'Status: Archived — replaced by Refund policy (2026) on Sep 24, 2026.' },
  { kind: 'keep', text: 'Customers may request a refund for any plan.' },
  { kind: 'del', text: 'Refunds are available within 14 days of purchase.' },
  { kind: 'add', text: 'For current terms, see Refund policy (2026).' },
  {
    kind: 'keep',
    text: 'Refunds are issued to the original payment method within 5–7 business days.',
  },
] as const

/** The Confluence edit Sim proposed, waiting on approval. */
function RefundPolicyEdit() {
  return (
    <div className='mx-auto flex max-w-[640px] flex-col gap-5 px-6 py-6'>
      <div className='flex flex-col gap-1'>
        <span className='text-[var(--text-muted)] text-caption'>
          Confluence · Billing › Policies · proposed edit by Sim
        </span>
        <h1 className='text-[20px] text-[var(--text-primary)]'>Refund policy (2024)</h1>
      </div>
      <div className='flex flex-col gap-0.5 font-mono text-caption'>
        {EDIT_LINES.map((line) => (
          <div
            key={line.text}
            className={cn(
              'rounded-md px-2 py-1',
              line.kind === 'add' && 'bg-[var(--surface-5)] text-[var(--text-primary)]',
              line.kind === 'del' && 'text-[var(--text-muted)] line-through',
              line.kind === 'keep' && 'text-[var(--text-muted)]'
            )}
          >
            {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '− ' : '  '}
            {line.text}
          </div>
        ))}
      </div>
      <p className='max-w-[48ch] text-[var(--text-muted)] text-small'>
        Replayed the last 48 refund questions without this page: every answer says 30 days for
        annual plans. Questions about pre-2026 orders will be handed to billing.
      </p>
      <div className='flex gap-1.5'>
        <Chip variant='primary'>Approve and send to chat</Chip>
        <Chip>Leave feedback</Chip>
      </div>
    </div>
  )
}
