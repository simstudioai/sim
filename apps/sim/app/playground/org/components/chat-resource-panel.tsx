'use client'

import { useState } from 'react'
import { Chip, cn } from '@sim/emcn'
import { Download, Link, Pencil, Send, Trash } from '@sim/emcn/icons'
import { IssuePage } from '@/app/playground/org/components/issue-page'
import { ProtoDashboard } from '@/app/playground/org/components/proto-dashboard'
import {
  mentionedIn,
  PANEL_KINDS,
  type PanelKind,
  type PanelResource,
  panelKindConfig,
  panelResourceKey,
  resourcesOfKind,
} from '@/app/playground/org/lib/chat-resources'
import { issueByKey, WORKSPACES, type Workspace } from '@/app/playground/org/lib/mock-data'
import {
  Resource,
  type ResourceColumn,
  type ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'

type View =
  | { type: 'browse'; kind: PanelKind | null }
  | { type: 'resource'; resource: PanelResource }

interface ChatResourcePanelProps {
  chatId: string
  workspace?: Workspace
  view: View
  onOpen: (resource: PanelResource) => void
  onBrowse: (kind: PanelKind | null) => void
}

/** Body of the resource panel: the new-tab browser or one open resource. */
export function ChatResourcePanel({
  chatId,
  workspace,
  view,
  onOpen,
  onBrowse,
}: ChatResourcePanelProps) {
  const [projectId, setProjectId] = useState<string | null>(workspace?.id ?? null)
  const project = projectId ? WORKSPACES.find((w) => w.id === projectId) : undefined

  if (view.type === 'resource') {
    return <ResourceView workspace={project} resource={view.resource} onBrowse={onBrowse} />
  }
  if (view.kind && project) {
    return (
      <KindList
        workspace={project}
        kind={view.kind}
        onOpen={onOpen}
        onBack={() => onBrowse(null)}
      />
    )
  }
  return (
    <div className='flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4'>
      {mentionedIn(chatId).length > 0 && (
        <Section label='Mentioned in this chat'>
          {mentionedIn(chatId).map((resource) => {
            const Icon = panelKindConfig(resource.kind).icon
            return (
              <Row key={panelResourceKey(resource)} onClick={() => onOpen(resource)}>
                <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>
                  {resource.name}
                </span>
                {resource.status && (
                  <span className='text-[var(--text-muted)] text-caption'>{resource.status}</span>
                )}
              </Row>
            )
          })}
        </Section>
      )}
      {project ? (
        <Section
          label={`Browse ${project.name}`}
          trailing={
            !workspace && (
              <button
                type='button'
                onClick={() => setProjectId(null)}
                className='text-[var(--text-muted)] text-caption hover-hover:text-[var(--text-body)]'
              >
                Change
              </button>
            )
          }
        >
          {PANEL_KINDS.map((kind) => (
            <Row key={kind.id} onClick={() => onBrowse(kind.id)}>
              <kind.icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
              <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>{kind.label}</span>
              <span className='text-[var(--text-muted)] text-caption'>
                {resourcesOfKind(project, kind.id).length}
              </span>
            </Row>
          ))}
        </Section>
      ) : (
        <Section label='Browse a project'>
          {WORKSPACES.map((candidate) => (
            <Row key={candidate.id} onClick={() => setProjectId(candidate.id)}>
              <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>
                {candidate.name}
              </span>
            </Row>
          ))}
        </Section>
      )}
    </div>
  )
}

interface SectionProps {
  label: string
  trailing?: React.ReactNode
  children: React.ReactNode
}

function Section({ label, trailing, children }: SectionProps) {
  return (
    <section className='flex flex-col gap-1'>
      <div className='flex h-[24px] items-center justify-between px-2'>
        <span className='text-[var(--text-muted)] text-caption'>{label}</span>
        {trailing}
      </div>
      {children}
    </section>
  )
}

interface RowProps {
  onClick: () => void
  children: React.ReactNode
}

function Row({ onClick, children }: RowProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex h-[30px] w-full items-center gap-2 rounded-lg px-2 text-left text-small transition-colors hover-hover:bg-[var(--surface-hover)]'
    >
      {children}
    </button>
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

interface ResourceViewProps {
  workspace?: Workspace
  resource: PanelResource
  onBrowse: (kind: PanelKind | null) => void
}

/** An open resource: the real resource header over mock content. */
function ResourceView({ workspace, resource, onBrowse }: ResourceViewProps) {
  const config = panelKindConfig(resource.kind)
  const Icon = config.icon
  return (
    <Resource>
      <Resource.Header
        icon={Icon}
        breadcrumbs={[
          { label: config.label, icon: Icon, onClick: () => onBrowse(resource.kind) },
          {
            label: resource.name,
            dropdownItems: [
              { label: 'Download', icon: Download, onClick: () => {} },
              { label: 'Rename', icon: Pencil, onClick: () => {} },
              { label: 'Share', icon: Send, onClick: () => {} },
              { label: 'Delete', icon: Trash, onClick: () => {} },
            ],
          },
        ]}
        actions={[
          { icon: Link, text: 'Copy Link', onSelect: () => {} },
          { icon: Download, text: 'Download', onSelect: () => {} },
          { icon: Send, text: 'Share', onSelect: () => {} },
          { icon: Trash, text: 'Delete', onSelect: () => {} },
        ]}
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <ResourceBody workspace={workspace} resource={resource} />
      </div>
    </Resource>
  )
}

function ResourceBody({ workspace, resource }: { workspace?: Workspace; resource: PanelResource }) {
  if (resource.kind === 'knowledge' && resource.id === 'refund-2024') return <RefundPolicyEdit />
  if (resource.kind === 'issues' && workspace) {
    const issue = issueByKey(resource.id)
    if (issue) return <IssuePage workspace={workspace} issue={issue} />
  }
  if (resource.kind === 'dashboard' && workspace) return <ProtoDashboard workspace={workspace} />
  return (
    <p className='px-6 py-16 text-center text-[var(--text-muted)] text-small'>
      {resource.name} opens here.
    </p>
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
