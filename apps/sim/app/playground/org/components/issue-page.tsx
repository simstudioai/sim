'use client'

import { useState } from 'react'
import { Avatar, Banner, Chip, ChipDropdown, ChipLink, chipVariants, cn } from '@sim/emcn'
import {
  ArrowUpRight,
  ChevronLeft,
  Circle,
  CircleCheck,
  Database,
  Files,
  Layout,
  Table,
  Workflow,
  X,
} from '@sim/emcn/icons'
import Link from 'next/link'
import { DelegateAvatar, delegateIcon } from '@/app/playground/org/components/delegate-avatar'
import {
  AgentStateIcon,
  PriorityIcon,
  RunningDot,
  SourceIcon,
  StatusIcon,
} from '@/app/playground/org/components/glyphs'
import { InvestigationView } from '@/app/playground/org/components/investigation/investigation-view'
import { TicketIcon } from '@/app/playground/org/components/linked-tickets'
import { MockComposer } from '@/app/playground/org/components/mock-composer'
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATUS_ORDER,
} from '@/app/playground/org/lib/issue-vocabulary'
import { type Project, realWorkspaceId } from '@/app/playground/org/lib/project'
import { useProjectSources } from '@/app/playground/org/lib/project-sources'
import { protoRoutes, workspaceRoutes } from '@/app/playground/org/lib/routes'
import type { Activity, Issue, PlanStep, Priority } from '@/app/playground/org/lib/types'
import { useProjectResources } from '@/app/playground/org/lib/use-project-resources'

const RESOURCE_ICONS = {
  table: Table,
  workflow: Workflow,
  dashboard: Layout,
  knowledge: Database,
  file: Files,
} as const

interface IssuePageProps {
  project: Project
  issue: Issue
}

/** Full-page issue, Linear-style: content column plus a properties column. */
export function IssuePage({ project, issue }: IssuePageProps) {
  const sources = useProjectSources()
  const resolveHref = useResourceHrefs(realWorkspaceId(project))
  const [status, setStatus] = useState(issue.status)
  const [priority, setPriority] = useState(issue.priority)
  const [activity, setActivity] = useState(issue.activity)
  const release = sources.releaseFor(project, issue)
  const tickets = sources.linkedTicketsFor(project, issue)
  const chats = sources.issueChatsFor(project, issue.key)
  const chatTitles = new Map(sources.chatsFor(project).map((chat) => [chat.id, chat.title]))

  return (
    <div className='relative flex h-full min-h-0 flex-col'>
      <header className='flex h-12 shrink-0 items-center gap-2 border-[var(--border)] border-b px-4'>
        <ChipLink href={protoRoutes.workspace(project.id)} leftIcon={ChevronLeft}>
          {project.name}
        </ChipLink>
        <span className='text-[var(--text-muted)] text-small'>/</span>
        <span className='text-[var(--text-body)] text-small'>{issue.key}</span>
      </header>
      {issue.agent?.state === 'error' && (
        <Banner
          variant='destructive'
          text={[...issue.activity].reverse().find((a) => a.kind === 'error')?.text}
          actionLabel='Open credentials'
        />
      )}
      <div className='flex min-h-0 flex-1'>
        <main className='min-w-0 flex-1 overflow-y-auto'>
          <div className='mx-auto flex max-w-[760px] flex-col gap-8 px-8 py-8'>
            <div className='flex flex-col gap-3'>
              <h1 className='text-[24px] text-[var(--text-primary)] leading-tight tracking-[-0.01em]'>
                {issue.title}
              </h1>
              {tickets.length > 0 && (
                <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-small'>
                  <span className='text-[var(--text-muted)]'>Tracks</span>
                  {tickets.map((ticket) => (
                    <a
                      key={ticket.key}
                      href={sources.ticketUrl(ticket)}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='flex items-center gap-1.5 text-[var(--text-body)] underline-offset-2 hover:underline'
                    >
                      <TicketIcon ticket={ticket} />
                      {ticket.key}
                    </a>
                  ))}
                </div>
              )}
              {!issue.investigation && (
                <p className='text-[var(--text-body)] text-sm'>
                  {issue.description || (
                    <span className='text-[var(--text-muted)]'>Add a description…</span>
                  )}
                </p>
              )}
            </div>

            {issue.investigation && <InvestigationView investigation={issue.investigation} />}

            {issue.research && (
              <Section title='Research' aside='Sim'>
                <p className='text-[var(--text-body)] text-small'>{issue.research.cause}</p>
                <div className='flex flex-wrap gap-1'>
                  {issue.research.related.map((ref) => (
                    <Chip key={ref} variant='border'>
                      {ref}
                    </Chip>
                  ))}
                </div>
              </Section>
            )}

            {issue.reports.length > 0 && !issue.investigation && (
              <Section title={`Reports · ${issue.reports.length}`}>
                <div className='flex flex-col gap-[1px]'>
                  {issue.reports.map((report) => (
                    <div
                      key={`${report.author}-${report.at}`}
                      className='flex items-center gap-3 rounded-lg px-2 py-1.5 text-small hover-hover:bg-[var(--surface-hover)]'
                    >
                      <SourceIcon source={report.source} />
                      <span className='shrink-0 text-[var(--text-body)]'>{report.author}</span>
                      <span className='min-w-0 flex-1 truncate text-[var(--text-muted)]'>
                        “{report.text}”
                      </span>
                      <span className='shrink-0 text-[var(--text-muted)] text-caption'>
                        {report.channel} · {report.at}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {issue.delegate && !issue.investigation && (
              <Section
                title='Agent session'
                aside={
                  <span className='flex items-center gap-1.5'>
                    {issue.agent && <AgentStateIcon state={issue.agent.state} />}
                    {issue.delegate.name}
                    {issue.agent && ` · ${issue.agent.label}`}
                  </span>
                }
              >
                {issue.plan.length > 0 && (
                  <div className='flex flex-col gap-1 rounded-lg border border-[var(--border)] px-3 py-2.5'>
                    {issue.plan.map((step) => (
                      <PlanRow key={step.label} step={step} />
                    ))}
                  </div>
                )}
                <div className='flex flex-col'>
                  {activity.map((item, index) => (
                    <ActivityRow key={`${item.at}-${index}`} activity={item} />
                  ))}
                </div>
                <MockComposer
                  rows={1}
                  placeholder={`Reply to ${issue.delegate.name} or leave a comment…`}
                  onSubmit={(text) =>
                    setActivity((prev) => [
                      ...prev,
                      { kind: 'response', text: `You: ${text}`, at: 'now' },
                    ])
                  }
                />
              </Section>
            )}
          </div>
        </main>

        <aside className='hidden w-[280px] shrink-0 flex-col gap-1 overflow-y-auto border-[var(--border)] border-l px-3 py-6 md:flex'>
          {tickets.length > 0 && (
            <div className='mb-4 flex flex-col gap-1'>
              <span className='px-2 text-[var(--text-muted)] text-caption'>Linked tickets</span>
              {tickets.map((ticket) => (
                <a
                  key={ticket.key}
                  href={sources.ticketUrl(ticket)}
                  target='_blank'
                  rel='noopener noreferrer'
                  className={cn(
                    chipVariants({ fullWidth: true }),
                    'h-auto flex-col items-start gap-0.5 py-1.5'
                  )}
                >
                  <span className='flex w-full items-center gap-1.5 text-small'>
                    <TicketIcon ticket={ticket} />
                    <span className='text-[var(--text-body)]'>{ticket.key}</span>
                    <span className='ml-auto text-[var(--text-muted)] text-caption'>
                      {ticket.status}
                    </span>
                  </span>
                  <span className='w-full truncate text-[var(--text-muted)] text-caption'>
                    {ticket.title}
                  </span>
                </a>
              ))}
            </div>
          )}
          {chats.length > 0 && (
            <div className='mb-4 flex flex-col gap-1'>
              <span className='px-2 text-[var(--text-muted)] text-caption'>Chats</span>
              {chats.map((chat) => (
                <Link
                  key={chat.id}
                  href={`${protoRoutes.issue(project.id, issue.key)}?chat=${chat.id}`}
                  className={cn(chipVariants({ fullWidth: true }), 'gap-2')}
                >
                  <Avatar size='xs' name={chat.owner} />
                  <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-small'>
                    {chatTitles.get(chat.id) ?? `${chat.owner}’s chat`}
                  </span>
                  {chat.running && <RunningDot />}
                </Link>
              ))}
            </div>
          )}
          <Property label='Status'>
            <ChipDropdown
              variant='ghost'
              value={status}
              onChange={(value) => setStatus(value as typeof status)}
              options={STATUS_ORDER.map((s) => ({
                value: s,
                label: STATUS_LABELS[s],
                iconElement: <StatusIcon status={s} />,
              }))}
            />
          </Property>
          <Property label='Priority'>
            <ChipDropdown
              variant='ghost'
              value={String(priority)}
              onChange={(value) => setPriority(Number(value) as Priority)}
              options={([0, 1, 2, 3, 4] as const).map((p) => ({
                value: String(p),
                label: PRIORITY_LABELS[p],
                iconElement: <PriorityIcon priority={p} />,
              }))}
            />
          </Property>
          <Property label='Owner'>
            <Chip leftAdornment={<DelegateAvatar owner={issue.owner} />}>{issue.owner.name}</Chip>
          </Property>
          <Property label='Delegate'>
            {issue.delegate ? (
              <Chip leftIcon={delegateIcon(issue.delegate)}>{issue.delegate.name}</Chip>
            ) : (
              <Chip className='text-[var(--text-muted)]'>Hand to an agent…</Chip>
            )}
          </Property>
          <Property label='Project'>
            <Chip>{issue.project ?? 'No project'}</Chip>
          </Property>
          {issue.due && (
            <Property label='Due'>
              <Chip>{issue.due}</Chip>
            </Property>
          )}
          {release && (
            <Property label='Shipped'>
              <Chip>
                {release.name} · {release.date}
              </Chip>
            </Property>
          )}
          {issue.investigation && (
            <div className='mt-4 flex flex-col gap-1'>
              <span className='px-2 text-[var(--text-muted)] text-caption'>Sources</span>
              {issue.investigation.sources.map((source) => {
                const href = resolveHref(
                  source.kind === 'workflow' ? 'workflow' : null,
                  source.label
                )
                return href ? (
                  <ChipLink key={source.label} href={href} fullWidth rightIcon={ArrowUpRight}>
                    {source.label}
                  </ChipLink>
                ) : (
                  <Chip key={source.label} fullWidth rightIcon={ArrowUpRight}>
                    {source.label}
                  </Chip>
                )
              })}
            </div>
          )}
          {issue.resources.length > 0 && (
            <div className='mt-4 flex flex-col gap-1'>
              <span className='px-2 text-[var(--text-muted)] text-caption'>Resources</span>
              {issue.resources.map((resource) => {
                const href = resolveHref(resource.kind, resource.name)
                return href ? (
                  <ChipLink
                    key={resource.name}
                    href={href}
                    fullWidth
                    leftIcon={RESOURCE_ICONS[resource.kind]}
                    rightIcon={ArrowUpRight}
                  >
                    {resource.name}
                  </ChipLink>
                ) : (
                  <Chip key={resource.name} fullWidth leftIcon={RESOURCE_ICONS[resource.kind]}>
                    {resource.name}
                  </Chip>
                )
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className='flex flex-col gap-3'>
      <div className='flex items-center gap-2 border-[var(--border)] border-b pb-2'>
        <span className='text-[var(--text-body)] text-small'>{title}</span>
        {aside && <span className='ml-auto text-[var(--text-muted)] text-caption'>{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex min-h-[32px] items-center gap-2'>
      <span className='w-[72px] shrink-0 px-2 text-[var(--text-muted)] text-small'>{label}</span>
      <div className='min-w-0 flex-1'>{children}</div>
    </div>
  )
}

function PlanRow({ step }: { step: PlanStep }) {
  const Icon = step.status === 'completed' ? CircleCheck : step.status === 'canceled' ? X : Circle
  return (
    <div className='flex items-center gap-2 text-small'>
      {step.status === 'inProgress' ? (
        <RunningDot />
      ) : (
        <Icon
          className={cn(
            'size-[14px] shrink-0',
            step.status === 'completed' ? 'text-[var(--brand-blue)]' : 'text-[var(--text-icon)]'
          )}
        />
      )}
      <span
        className={cn(
          step.status === 'canceled'
            ? 'text-[var(--text-muted)] line-through'
            : 'text-[var(--text-body)]'
        )}
      >
        {step.label}
      </span>
    </div>
  )
}

const ACTIVITY_PREFIX: Record<Activity['kind'], string> = {
  thought: 'Thinking',
  action: '',
  elicitation: 'Question',
  response: '',
  error: 'Error',
}

function ActivityRow({ activity }: { activity: Activity }) {
  return (
    <div className='flex items-start gap-3 py-1.5 text-small'>
      <span
        className={cn(
          'mt-[7px] size-[5px] shrink-0 rounded-full',
          activity.kind === 'error'
            ? 'bg-[var(--text-error)]'
            : activity.kind === 'elicitation'
              ? 'bg-[var(--caution)]'
              : 'bg-[var(--text-icon)]'
        )}
      />
      <span
        className={cn(
          'min-w-0 flex-1',
          activity.kind === 'thought'
            ? 'text-[var(--text-muted)] italic'
            : 'text-[var(--text-body)]'
        )}
      >
        {ACTIVITY_PREFIX[activity.kind] && (
          <span className='text-[var(--text-muted)]'>{ACTIVITY_PREFIX[activity.kind]}: </span>
        )}
        {activity.text}
      </span>
      <span className='shrink-0 text-[var(--text-muted)] text-caption'>{activity.at}</span>
    </div>
  )
}

type ResourceKind = Issue['resources'][number]['kind']

/**
 * Resolves a pack resource to the real workspace page with the same name, so the mock issue's
 * links land on the seeded workflow, table, knowledge base or file. Unmatched names stay plain.
 */
function useResourceHrefs(workspaceId: string) {
  const { workflows, tables, knowledgeBases, files } = useProjectResources(workspaceId)
  return (kind: ResourceKind | null, name: string): string | null => {
    const wanted = name.trim().toLowerCase()
    const matches = (candidate: string) => candidate.trim().toLowerCase() === wanted
    if (kind === 'workflow' || kind === null) {
      const workflow = workflows.find((w) => matches(w.name))
      if (workflow) return workspaceRoutes.workflow(workspaceId, workflow.id)
    }
    if (kind === 'table' || kind === null) {
      const table = tables.find((t) => matches(t.name))
      if (table) return workspaceRoutes.table(workspaceId, table.id)
    }
    if (kind === 'knowledge' || kind === null) {
      const base = knowledgeBases.find((b) => matches(b.name))
      if (base) return workspaceRoutes.knowledgeBase(workspaceId, base.id)
    }
    if (kind === 'file' || kind === 'dashboard' || kind === null) {
      const file = files.find((f) => matches(f.name) || matches(f.name.replace(/\.[^.]+$/, '')))
      if (file) return workspaceRoutes.file(workspaceId, file.id)
    }
    return null
  }
}
