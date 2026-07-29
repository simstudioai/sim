'use client'

import { useState } from 'react'
import { Badge, Chip, ChipInput, ChipLink, ChipTextarea, Label, Skeleton } from '@sim/emcn'
import { Download, RefreshCw, Send } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDateTime } from '@sim/utils/formatting'
import type { NewsletterRun } from '@/lib/api/contracts/newsletters'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  useCreateNewsletterRun,
  useFinalizeNewsletterRun,
  useNewsletterJob,
  useNewsletterRuns,
  usePushNewsletterRunToResend,
} from '@/hooks/queries/newsletters'

const PRESETS = [
  { label: 'Everyone', prompt: 'Everyone' },
  { label: 'Instagram users', prompt: 'Users who use the Instagram integration' },
  {
    label: 'Instagram chat context',
    prompt: 'Users whose chat context mentions Instagram in the last 90 days',
  },
  { label: 'Recently active', prompt: 'Users active in the last 30 days' },
]

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDateTime(date)
}

function statusBadge(run: NewsletterRun) {
  if (run.status === 'pushed')
    return (
      <Badge variant='green' dot>
        Pushed
      </Badge>
    )
  if (run.status === 'pushing')
    return (
      <Badge variant='amber' dot>
        Pushing
      </Badge>
    )
  if (run.status === 'finalizing')
    return (
      <Badge variant='amber' dot>
        Finalizing
      </Badge>
    )
  if (run.status === 'oversized')
    return (
      <Badge variant='red' dot>
        Too large
      </Badge>
    )
  if (run.status === 'failed')
    return (
      <Badge variant='red' dot>
        Failed
      </Badge>
    )
  if (run.status === 'finalized')
    return (
      <Badge variant='blue' dot>
        Finalized
      </Badge>
    )
  return (
    <Badge variant='gray' dot>
      Draft
    </Badge>
  )
}

function CriteriaLabel({ run }: { run: NewsletterRun }) {
  const criteria = run.criteria
  if (criteria.type === 'everyone') return <span>Everyone</span>
  if (criteria.type === 'integration_users') {
    return <span>{criteria.integration} integration users</span>
  }
  if (criteria.type === 'chat_mentions') return <span>Chats mentioning {criteria.term}</span>
  return <span>Active in the last {criteria.timeWindowDays} days</span>
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className='flex min-w-0 flex-col gap-1 px-1 py-1'>
      <span className='truncate text-[var(--text-muted)] text-caption'>{label}</span>
      <span className='font-medium text-[var(--text-primary)] text-sm'>{formatNumber(value)}</span>
    </div>
  )
}

function RunCard({
  run,
  activeJob,
  onFinalize,
  onPush,
  finalizePending,
  pushPending,
}: {
  run: NewsletterRun
  activeJob: ReturnType<typeof useNewsletterJob>['data']
  onFinalize: (id: string) => void
  onPush: (id: string) => void
  finalizePending: boolean
  pushPending: boolean
}) {
  const canFinalize = run.status === 'draft'
  const canExport = ['finalized', 'pushing', 'pushed', 'failed'].includes(run.status)
  const canPush = run.status === 'finalized' || run.status === 'failed' || run.status === 'pushing'
  const csvHref = `/api/superuser/newsletters/runs/${encodeURIComponent(run.id)}/export.csv`

  return (
    <div className='flex flex-col gap-3 rounded-[8px] border border-[var(--border)] p-3'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <h3 className='truncate font-medium text-[var(--text-primary)] text-sm'>{run.name}</h3>
            {statusBadge(run)}
          </div>
          <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-muted)] text-caption'>
            <CriteriaLabel run={run} />
            <span>{formatDate(run.createdAt)}</span>
            {run.resendSegmentName && <span>{run.resendSegmentName}</span>}
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2 sm:shrink-0'>
          {canFinalize && (
            <Chip
              variant='primary'
              flush
              onClick={() => onFinalize(run.id)}
              disabled={finalizePending}
            >
              {finalizePending ? 'Finalizing...' : 'Finalize'}
            </Chip>
          )}
          {canExport && (
            <ChipLink href={csvHref} download flush leftIcon={Download}>
              CSV
            </ChipLink>
          )}
          {canPush && (
            <Chip
              variant='primary'
              flush
              leftIcon={Send}
              onClick={() => onPush(run.id)}
              disabled={pushPending}
            >
              {pushPending ? 'Queueing...' : run.status === 'pushing' ? 'Resume queue' : 'Resend'}
            </Chip>
          )}
        </div>
      </div>

      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6'>
        <Stat label='Matched' value={run.counts.totalMatched} />
        <Stat label='Recipients' value={run.counts.finalRecipientCount} />
        <Stat label='Banned' value={run.counts.excludedBanned} />
        <Stat label='Unverified' value={run.counts.excludedUnverified} />
        <Stat label='Opted out' value={run.counts.excludedUnsubscribed} />
        <Stat label='Suppressed' value={run.counts.excludedSuppressed} />
      </div>

      {run.sampleRecipients.length > 0 && (
        <div className='flex flex-col gap-1'>
          <p className='text-[var(--text-muted)] text-caption'>Sample</p>
          <div className='grid grid-cols-1 gap-x-3 gap-y-1 text-small sm:grid-cols-2'>
            {run.sampleRecipients.slice(0, 6).map((recipient) => (
              <div key={`${run.id}-${recipient.userId}`} className='min-w-0 truncate'>
                <span className='text-[var(--text-primary)]'>{recipient.email}</span>
                <span className='text-[var(--text-muted)]'> · {recipient.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(run.error || activeJob?.job || run.resendSegmentId) && (
        <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--text-muted)] text-caption'>
          {activeJob?.job && <span>Job {activeJob.job.status}</span>}
          {run.resendSegmentId && <span>Segment {run.resendSegmentId}</span>}
          {run.resendSyncedAt && <span>Synced {formatDate(run.resendSyncedAt)}</span>}
          {run.error && <span className='text-[var(--text-error)]'>{run.error}</span>}
        </div>
      )}
    </div>
  )
}

export function Newsletters() {
  const { data, isLoading, refetch } = useNewsletterRuns()
  const createRun = useCreateNewsletterRun()
  const finalizeRun = useFinalizeNewsletterRun()
  const pushRun = usePushNewsletterRunToResend()
  const activePushRunId =
    pushRun.data?.run.id ??
    data?.runs.find((run) => run.status === 'pushing' && run.resendSyncJobId)?.id
  const activeJob = useNewsletterJob(activePushRunId, Boolean(activePushRunId))

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('Everyone')

  const mutationError = createRun.error || finalizeRun.error || pushRun.error
  const error = mutationError ? getErrorMessage(mutationError) : null

  const handleCreate = () => {
    const trimmedName = name.trim()
    const trimmedPrompt = prompt.trim()
    if (!trimmedName || !trimmedPrompt) return
    createRun.mutate(
      { name: trimmedName, prompt: trimmedPrompt },
      {
        onSuccess: () => {
          setName('')
          setPrompt('Everyone')
        },
      }
    )
  }

  return (
    <SettingsPanel>
      <div className='flex flex-col gap-6'>
        <div className='flex flex-col gap-3 rounded-[8px] border border-[var(--border)] p-3'>
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-[220px_minmax(0,1fr)]'>
            <div className='flex flex-col gap-[9px]'>
              <Label htmlFor='newsletter-name' className='text-[var(--text-muted)] text-small'>
                Name
              </Label>
              <ChipInput
                id='newsletter-name'
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder='July launch'
              />
            </div>
            <div className='flex flex-col gap-[9px]'>
              <Label htmlFor='newsletter-targeting' className='text-[var(--text-muted)] text-small'>
                Targeting
              </Label>
              <ChipTextarea
                id='newsletter-targeting'
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder='Users whose chat context mentions Instagram'
                rows={3}
              />
            </div>
          </div>
          <div className='flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div className='flex flex-wrap gap-2'>
              {PRESETS.map((preset) => (
                <Chip
                  key={preset.label}
                  active={prompt === preset.prompt}
                  onClick={() => setPrompt(preset.prompt)}
                >
                  {preset.label}
                </Chip>
              ))}
            </div>
            <Chip
              variant='primary'
              flush
              onClick={handleCreate}
              disabled={!name.trim() || !prompt.trim() || createRun.isPending}
            >
              {createRun.isPending ? 'Previewing...' : 'Create preview'}
            </Chip>
          </div>
          {error && <p className='text-[var(--text-error)] text-caption'>{error}</p>}
        </div>

        <div className='flex items-center justify-between'>
          <h2 className='font-medium text-[var(--text-primary)] text-sm'>Runs</h2>
          <Chip leftIcon={RefreshCw} onClick={() => refetch()} disabled={isLoading}>
            Refresh
          </Chip>
        </div>

        {isLoading ? (
          <div className='flex flex-col gap-3'>
            <Skeleton className='h-[132px] rounded-[8px]' />
            <Skeleton className='h-[132px] rounded-[8px]' />
          </div>
        ) : data?.runs.length ? (
          <div className='flex flex-col gap-3'>
            {data.runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                activeJob={run.id === activePushRunId ? activeJob.data : undefined}
                onFinalize={(id) => finalizeRun.mutate(id)}
                onPush={(id) => pushRun.mutate(id)}
                finalizePending={finalizeRun.isPending && finalizeRun.variables === run.id}
                pushPending={pushRun.isPending && pushRun.variables === run.id}
              />
            ))}
          </div>
        ) : (
          <SettingsEmptyState variant='inline'>No newsletter runs yet.</SettingsEmptyState>
        )}
      </div>
    </SettingsPanel>
  )
}
