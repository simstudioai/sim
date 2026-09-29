'use client'

import { useState } from 'react'
import { Avatar, Chip, ChipTag, cn, toast } from '@sim/emcn'
import {
  ArrowUpRight,
  ChevronDown,
  CircleCheck,
  Clock,
  Database,
  Library,
  MessageSquareText,
  RefreshCw,
  Rocket,
  SlidersHorizontal,
  Workflow,
} from '@sim/emcn/icons'
import { ConfluenceIcon, SlackMonoIcon } from '@/components/icons'
import { AgentStateIcon } from '@/app/playground/org/components/glyphs'
import { DiffLines, EvidenceView } from '@/app/playground/org/components/investigation/evidence'
import type {
  Investigation,
  InvestigationStep,
  SourceMessage,
} from '@/app/playground/org/lib/infra-data'

const STEP_ICONS: Record<InvestigationStep['kind'], React.ComponentType<{ className?: string }>> = {
  feedback: MessageSquareText,
  check: Database,
  workflow: Workflow,
  runs: Library,
  run: Library,
  config: SlidersHorizontal,
  history: Clock,
  conclusion: CircleCheck,
}

const EVIDENCE_LABEL = { run: 'run', runs: 'runs', diff: 'change' } as const

type Decision = 'pending' | 'redeployed' | 'rejected'

const SECTION_IDS = [
  'summary',
  'report',
  'documents',
  'rootCause',
  'frequency',
  'proposal',
  'investigation',
] as const
type SectionId = (typeof SECTION_IDS)[number]

/** An agent investigation of a workflow, read top-down, ending in a redeploy approval. */
export function InvestigationView({ investigation }: { investigation: Investigation }) {
  const [decision, setDecision] = useState<Decision>('pending')
  const { origin, documents } = investigation

  const sections: Record<SectionId, SectionProps> = {
    summary: {
      id: 'summary',
      title: 'Summary',
      children: <Summary investigation={investigation} />,
    },
    report: {
      id: 'report',
      title: origin.kind === 'slack' ? 'Reported in Slack' : 'Detected by a knowledge check',
      children:
        origin.kind === 'slack' ? (
          <SlackThread trigger={origin.message} thread={origin.thread} />
        ) : (
          <KnowledgeCheck origin={origin} />
        ),
    },
    documents: {
      id: 'documents',
      title: 'Contradicting documents',
      aside: documents ? `${documents.length} Confluence pages` : undefined,
      children: documents ? <Documents documents={documents} /> : null,
    },
    rootCause: {
      id: 'rootCause',
      title: 'Root cause',
      aside: <ChipTag variant='gray'>{investigation.rootCause.confidence} confidence</ChipTag>,
      children: <RootCause rootCause={investigation.rootCause} />,
    },
    frequency: {
      id: 'frequency',
      title: 'Seen in production',
      aside: (
        <Chip leftIcon={RefreshCw} className='h-[22px]'>
          Re-check
        </Chip>
      ),
      children: <Frequency frequency={investigation.frequency} />,
    },
    proposal: {
      id: 'proposal',
      title: 'Proposed fix',
      children: <ProposedFix investigation={investigation} />,
    },
    investigation: {
      id: 'investigation',
      title: 'Investigation',
      aside: `${investigation.timeline.length} steps · 6 min`,
      children: <Timeline steps={investigation.timeline} />,
    },
  }

  return (
    <div className='flex flex-col gap-7'>
      <StatusStrip investigation={investigation} decision={decision} onDecide={setDecision} />
      {SECTION_IDS.filter((id) => id !== 'documents' || documents).map((id) => (
        <Section key={id} {...sections[id]} />
      ))}
    </div>
  )
}

function Summary({ investigation }: { investigation: Investigation }) {
  return (
    <div className='flex flex-col gap-2 rounded-lg bg-[var(--surface-2)] px-4 py-3'>
      {investigation.summary
        .filter((row) => row.label !== 'Fix')
        .map((row) => (
          <div key={row.label} className='grid grid-cols-[56px_minmax(0,1fr)] gap-3 text-small'>
            <span className='text-[var(--text-muted)]'>{row.label}</span>
            <span className='text-[var(--text-body)]'>{row.text}</span>
          </div>
        ))}
    </div>
  )
}

interface StatusStripProps {
  investigation: Investigation
  decision: Decision
  onDecide: (decision: Decision) => void
}

/** The one decision on the page, pinned at the top: redeploy the fix or reject it. */
function StatusStrip({ investigation, decision, onDecide }: StatusStripProps) {
  const { workflow, proposal } = investigation
  if (proposal.docEdit)
    return (
      <div className='flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2.5 text-small'>
        <AgentStateIcon state='awaitingInput' />
        <span className='flex-1 text-[var(--text-body)]'>
          {`infra-analyzer stopped before editing ${proposal.docEdit.page} in Confluence.`}
        </span>
      </div>
    )
  if (decision === 'redeployed')
    return (
      <div className='flex items-center gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-small'>
        <CircleCheck className='size-[14px] text-[var(--success)]' />
        <span className='text-[var(--text-body)]'>
          {`${workflow.name} ${workflow.nextVersion} is live. infra-analyzer is watching new runs.`}
        </span>
      </div>
    )
  if (decision === 'rejected')
    return (
      <p className='rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-[var(--text-muted)] text-small'>
        Fix rejected. The investigation stays on record; the workflow was not changed.
      </p>
    )
  return (
    <div className='flex items-center gap-2 rounded-lg border border-[var(--border)] py-1.5 pr-1.5 pl-3 text-small'>
      <AgentStateIcon state='awaitingInput' />
      <span className='flex-1 text-[var(--text-body)]'>
        {`infra-analyzer stopped before changing ${workflow.name}.`}
      </span>
      <Chip onClick={() => onDecide('rejected')}>Reject</Chip>
      <Chip
        variant='primary'
        leftIcon={Rocket}
        onClick={() => {
          onDecide('redeployed')
          toast.success(`${workflow.name} ${workflow.nextVersion} deployed`)
        }}
      >
        {`Redeploy as ${workflow.nextVersion}`}
      </Chip>
    </div>
  )
}

interface SectionProps {
  id: string
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}

function Section({ id, title, aside, children }: SectionProps) {
  return (
    <section id={id} className='flex scroll-mt-6 flex-col gap-3'>
      <div className='flex min-h-[22px] items-center gap-2'>
        <h2 className='text-[var(--text-primary)] text-sm'>{title}</h2>
        {aside && <div className='ml-auto text-[var(--text-muted)] text-caption'>{aside}</div>}
      </div>
      {children}
    </section>
  )
}

type KbOrigin = Extract<Investigation['origin'], { kind: 'kbQuery' }>

/** The automatic query that surfaced the problem, with the answers that disagreed. */
function KnowledgeCheck({ origin }: { origin: KbOrigin }) {
  return (
    <div className='flex flex-col gap-3 rounded-lg border border-[var(--border)] px-4 py-3'>
      <div className='flex items-center gap-2 text-caption'>
        <Database className='size-[12px] text-[var(--text-icon)]' />
        <span className='text-[var(--text-body)]'>{origin.knowledgeBase}</span>
        <span className='text-[var(--text-muted)]'>{`· knowledge check · ${origin.at}`}</span>
      </div>
      <p className='text-[var(--text-body)] text-sm'>{`“${origin.query}”`}</p>
      <div className='flex flex-col gap-1.5'>
        {origin.answers.map((answer) => (
          <div key={answer.cites} className='flex items-start gap-3 text-small'>
            <span className='mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--caution)]' />
            <span className='min-w-0 flex-1 text-[var(--text-body)]'>{answer.answer}</span>
            <span className='shrink-0 text-[var(--text-muted)] text-caption'>{answer.cites}</span>
          </div>
        ))}
      </div>
      <p className='text-[var(--text-muted)] text-caption'>{origin.detail}</p>
    </div>
  )
}

/** The source pages side by side, the conflicting sentence marked in each. */
function Documents({ documents }: { documents: NonNullable<Investigation['documents']> }) {
  return (
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
      {documents.map((doc) => (
        <article
          key={doc.title}
          className='flex flex-col gap-3 rounded-lg border border-[var(--border)] px-4 py-3'
        >
          <header className='flex items-start gap-2'>
            <ConfluenceIcon className='mt-0.5 size-[14px] shrink-0' />
            <div className='flex min-w-0 flex-1 flex-col'>
              <span className='truncate text-[var(--text-body)] text-small'>{doc.title}</span>
              <span className='text-[var(--text-muted)] text-caption'>
                {`${doc.space} · ${doc.author} · ${doc.updated}`}
              </span>
            </div>
            <ArrowUpRight className='size-[12px] shrink-0 text-[var(--text-icon)]' />
          </header>
          <div className='flex flex-col gap-2 text-small leading-relaxed'>
            {doc.excerpt.map((line) =>
              line === doc.highlight ? (
                <mark
                  key={line}
                  className='rounded-[3px] bg-[var(--badge-amber-bg)] px-1 text-[var(--text-primary)]'
                >
                  {line}
                </mark>
              ) : (
                <p key={line} className='text-[var(--text-muted)]'>
                  {line}
                </p>
              )
            )}
          </div>
        </article>
      ))}
    </div>
  )
}

function SlackThread({ trigger, thread }: { trigger: SourceMessage; thread: SourceMessage[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className='rounded-lg border border-[var(--border)]'>
      <SlackMessage message={trigger} />
      <button
        type='button'
        onClick={() => setOpen((prev) => !prev)}
        className='flex w-full items-center gap-1 border-[var(--border)] border-t px-3 py-1.5 text-[var(--text-muted)] text-caption hover-hover:bg-[var(--surface-hover)]'
      >
        {thread.length} replies
        <ChevronDown className={cn('size-[12px] transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <div className='border-[var(--border)] border-t'>
          {thread.map((message, index) => (
            <SlackMessage key={index} message={message} />
          ))}
        </div>
      )}
    </div>
  )
}

function SlackMessage({ message }: { message: SourceMessage }) {
  return (
    <div className='flex gap-3 px-3 py-2.5'>
      <Avatar size='sm' name={message.author} />
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <div className='flex items-center gap-2 text-caption'>
          <span className='text-[var(--text-body)]'>{message.author}</span>
          <span className='flex items-center gap-1 text-[var(--text-muted)]'>
            <SlackMonoIcon className='size-[11px]' />
            {message.channel} · {message.at}
          </span>
          <ArrowUpRight className='ml-auto size-[12px] text-[var(--text-icon)]' />
        </div>
        <p className='text-[var(--text-body)] text-small'>{message.text}</p>
      </div>
    </div>
  )
}

/** Collapsed to one line by default; the summary and root cause carry the story. */
function Timeline({ steps }: { steps: InvestigationStep[] }) {
  const [expanded, setExpanded] = useState(false)
  const [openSteps, setOpenSteps] = useState<Set<number>>(() => new Set())
  const toggle = (index: number) =>
    setOpenSteps((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  if (!expanded)
    return (
      <button
        type='button'
        onClick={() => setExpanded(true)}
        className='flex w-full items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 text-left text-small hover-hover:bg-[var(--surface-hover)]'
      >
        <span className='-space-x-1 flex shrink-0 items-center'>
          {steps.slice(0, 5).map((step, index) => {
            const Icon = STEP_ICONS[step.kind]
            return (
              <span
                key={index}
                className='flex size-[20px] items-center justify-center rounded-full bg-[var(--surface-3)] ring-2 ring-[var(--bg)]'
              >
                <Icon className='size-[11px] text-[var(--text-icon)]' />
              </span>
            )
          })}
        </span>
        <span className='min-w-0 flex-1 truncate text-[var(--text-muted)]'>
          {`${steps[0].title} → ${steps[steps.length - 1].title}`}
        </span>
        <span className='flex shrink-0 items-center gap-1 text-[var(--text-body)]'>
          {`Show ${steps.length} steps`}
          <ChevronDown className='size-[12px] text-[var(--text-icon)]' />
        </span>
      </button>
    )
  return (
    <ol className='flex flex-col'>
      {steps.map((step, index) => {
        const Icon = STEP_ICONS[step.kind]
        const last = index === steps.length - 1
        const open = openSteps.has(index)
        return (
          <li key={index} className='grid grid-cols-[44px_20px_minmax(0,1fr)] gap-x-3'>
            <span className='pt-0.5 text-right text-[var(--text-muted)] text-caption tabular-nums'>
              {step.at}
            </span>
            <div className='flex flex-col items-center'>
              <span className='flex size-[20px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-3)]'>
                <Icon
                  className={cn(
                    'size-[12px]',
                    step.kind === 'conclusion'
                      ? 'text-[var(--brand-blue)]'
                      : 'text-[var(--text-icon)]'
                  )}
                />
              </span>
              {!last && <span className='w-px flex-1 bg-[var(--border)]' />}
            </div>
            <div className={cn('flex min-w-0 flex-col gap-1.5', !last && 'pb-5')}>
              <div className='flex items-center gap-2'>
                <span className='text-[var(--text-body)] text-small'>{step.title}</span>
                {step.evidence && (
                  <Chip className='ml-auto h-[22px] shrink-0' onClick={() => toggle(index)}>
                    {open ? 'Hide' : 'Show'} {EVIDENCE_LABEL[step.evidence.type]}
                  </Chip>
                )}
              </div>
              {step.detail && <p className='text-[var(--text-muted)] text-small'>{step.detail}</p>}
              {step.evidence && open && <EvidenceView evidence={step.evidence} />}
            </div>
          </li>
        )
      })}
      <li className='pl-[76px]'>
        <button
          type='button'
          onClick={() => setExpanded(false)}
          className='text-[var(--text-muted)] text-small hover-hover:text-[var(--text-body)]'
        >
          Hide steps
        </button>
      </li>
    </ol>
  )
}

/** The summary sentence up front; the causal chain and the block live behind Details. */
function RootCause({ rootCause }: { rootCause: Investigation['rootCause'] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className='flex flex-col gap-2'>
      <p className='text-[var(--text-body)] text-sm leading-relaxed'>{rootCause.summary}</p>
      <button
        type='button'
        onClick={() => setOpen((prev) => !prev)}
        className='flex items-center gap-1 self-start text-[var(--text-muted)] text-small hover-hover:text-[var(--text-body)]'
      >
        {open ? 'Hide details' : 'Details'}
        <ChevronDown className={cn('size-[12px] transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <div className='flex flex-col gap-3 rounded-lg border border-[var(--border)] px-4 py-3'>
          <ol className='flex flex-col gap-1.5'>
            {rootCause.chain.map((link, index) => (
              <li key={index} className='flex gap-3 text-small'>
                <span className='w-4 shrink-0 text-right text-[var(--text-muted)] tabular-nums'>
                  {index + 1}
                </span>
                <span className='text-[var(--text-body)]'>{link}</span>
              </li>
            ))}
          </ol>
          <pre className='overflow-x-auto rounded-md bg-[var(--surface-2)] px-3 py-2 font-mono text-[var(--text-body)] text-caption'>
            {`${rootCause.block.path}\n${rootCause.block.lines.join('\n')}`}
          </pre>
          <p className='text-[var(--text-muted)] text-caption'>{rootCause.confidenceReason}</p>
        </div>
      )}
    </div>
  )
}

/** Stats on one line over a compact bar strip; the full chart lives in Dashboard. */
function Frequency({ frequency }: { frequency: Investigation['frequency'] }) {
  const max = Math.max(...frequency.days.map((day) => day.count), 1)
  return (
    <div className='flex flex-col gap-3'>
      <p className='text-[var(--text-body)] text-small'>
        {frequency.stats.map((stat, index) => (
          <span key={stat.label}>
            {index > 0 && <span className='px-2 text-[var(--text-muted)]'>·</span>}
            <span className='text-[var(--text-muted)]'>{`${stat.label} `}</span>
            {stat.value}
          </span>
        ))}
      </p>
      <div
        role='img'
        aria-label={`Unwanted replies per day, last ${frequency.days.length} days`}
        className='flex h-[48px] items-end gap-[3px]'
      >
        {frequency.days.map((day) => (
          <div
            key={day.date}
            title={`${day.date}: ${day.count}`}
            className={cn(
              'flex-1 rounded-[2px]',
              day.count ? 'bg-[var(--text-icon)]' : 'bg-[var(--surface-4)]'
            )}
            style={{ height: `${Math.max(6, (day.count / max) * 100)}%` }}
          />
        ))}
      </div>
    </div>
  )
}

/** Plain words: what changes, what the replay showed, and what people will notice. */
function ProposedFix({ investigation }: { investigation: Investigation }) {
  const { proposal, workflow } = investigation
  const { docEdit } = proposal
  if (!docEdit)
    return (
      <p className='text-[var(--text-body)] text-sm leading-relaxed'>
        {`${proposal.summary} This ships as ${workflow.name} ${workflow.nextVersion}. ${proposal.replay} ${proposal.tradeoff}`}
      </p>
    )
  return (
    <div className='flex flex-col gap-3'>
      <p className='text-[var(--text-body)] text-sm leading-relaxed'>
        {`${proposal.summary} ${proposal.replay}`}
      </p>
      <div className='overflow-hidden rounded-lg border border-[var(--border)]'>
        <div className='flex items-center gap-2 border-[var(--border)] border-b bg-[var(--surface-2)] px-3 py-1.5 text-caption'>
          <ConfluenceIcon className='size-[12px] shrink-0' />
          <span className='text-[var(--text-body)]'>{docEdit.page}</span>
          <span className='text-[var(--text-muted)]'>{docEdit.space}</span>
        </div>
        <DiffLines lines={docEdit.lines} />
      </div>
      <p className='text-[var(--text-muted)] text-small'>{proposal.tradeoff}</p>
      <div className='flex items-center justify-end gap-1'>
        <Chip leftIcon={MessageSquareText}>Leave feedback</Chip>
        <Chip variant='primary' leftIcon={CircleCheck}>
          Approve and send to chat
        </Chip>
      </div>
    </div>
  )
}
