'use client'

import { useState } from 'react'
import { Badge, ChipConfirmModal, Label, Switch, toast } from '@sim/emcn'
import { ArrowLeft, Database } from '@sim/emcn/icons'
import { toError } from '@sim/utils/errors'
import type { DataDrain, DataDrainRun } from '@/lib/api/contracts/data-drains'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { ResourceTile } from '@/app/workspace/[workspaceId]/components'
import { CredentialDetailHeading } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  useDataDrainRuns,
  useDeleteDataDrain,
  useRunDataDrainNow,
  useTestDataDrain,
  useUpdateDataDrain,
} from '@/ee/data-drains/hooks/data-drains'
import { CADENCE_LABELS, DESTINATION_LABELS, SOURCE_LABELS } from '@/ee/data-drains/labels'

const RECENT_RUN_LIMIT = 10

/** Rendered generically so a new destination's config needs no formatter. */
function formatConfigValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

/** Config keys carrying these read as initialisms, not words. */
const CONFIG_KEY_ACRONYMS: Record<string, string> = {
  id: 'ID',
  url: 'URL',
  json: 'JSON',
  api: 'API',
}

/**
 * `forcePathStyle` → `Force path style`, `accessKeyId` → `Access key ID`. Sentence
 * case so a new destination field needs no per-key label map.
 */
function humanizeConfigKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => CONFIG_KEY_ACRONYMS[word] ?? word)
  const [first = '', ...rest] = words
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

interface DetailRowProps {
  label: string
  children: React.ReactNode
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <span className='flex-shrink-0 text-[var(--text-muted)] text-small'>{label}</span>
      <span className='min-w-0 break-words text-right text-[var(--text-body)] text-sm'>
        {children}
      </span>
    </div>
  )
}

interface DataDrainDetailProps {
  organizationId: string
  drain: DataDrain
  onBack: () => void
}

/**
 * Full-page data drain detail rendered as a settings detail sub-view: a back
 * chip, the drain's actions (Run now / Test connection / Delete), its resolved
 * configuration, and recent run history. Only the enabled toggle is editable —
 * destination credentials are never returned, so changing one means recreating
 * the drain.
 */
export function DataDrainDetail({ organizationId, drain, onBack }: DataDrainDetailProps) {
  const updateDrain = useUpdateDataDrain()
  const deleteDrain = useDeleteDataDrain()
  const runDrain = useRunDataDrainNow()
  const testDrain = useTestDataDrain()
  const {
    data: runs,
    isPending: runsPending,
    isPlaceholderData: runsArePlaceholder,
  } = useDataDrainRuns(organizationId, drain.id, RECENT_RUN_LIMIT)
  // Defensive: the runs query keeps previous data, which would read as another
  // drain's history if this view ever renders without a per-drain key.
  const runsLoading = runsPending || runsArePlaceholder

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleToggleEnabled = async () => {
    try {
      await updateDrain.mutateAsync({
        organizationId,
        drainId: drain.id,
        body: { enabled: !drain.enabled },
      })
      toast.success(drain.enabled ? 'Drain disabled' : 'Drain enabled')
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  const handleRunNow = async () => {
    try {
      await runDrain.mutateAsync({ organizationId, drainId: drain.id })
      toast.success('Run queued')
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  const handleTest = async () => {
    try {
      await testDrain.mutateAsync({ organizationId, drainId: drain.id })
      toast.success('Connection test passed')
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  const handleConfirmDelete = async () => {
    setShowDeleteConfirm(false)
    try {
      await deleteDrain.mutateAsync({ organizationId, drainId: drain.id })
      onBack()
      toast.success('Drain deleted')
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  const actions: SettingsAction[] = [
    {
      text: 'Run now',
      onSelect: handleRunNow,
      disabled: !drain.enabled || runDrain.isPending,
      tooltip: drain.enabled ? undefined : 'Enable the drain to run it',
    },
    { text: 'Test connection', onSelect: handleTest, disabled: testDrain.isPending },
    {
      text: 'Delete',
      variant: 'destructive',
      onSelect: () => setShowDeleteConfirm(true),
      disabled: deleteDrain.isPending,
    },
  ]

  return (
    <>
      <SettingsPanel
        back={{ text: 'Data drains', icon: ArrowLeft, onSelect: onBack }}
        title={drain.name}
        actions={actions}
      >
        <div className='flex flex-col gap-7'>
          <CredentialDetailHeading
            leading={<ResourceTile icon={Database} />}
            title={drain.name}
            subtitle={`${SOURCE_LABELS[drain.source]} → ${DESTINATION_LABELS[drain.destinationType]} · ${CADENCE_LABELS[drain.scheduleCadence]}`}
          />

          <SettingsSection label='Status'>
            <div className='flex items-center justify-between'>
              <div className='flex flex-col gap-1'>
                <Label htmlFor='data-drain-enabled'>Enabled</Label>
                <p className='text-[var(--text-muted)] text-caption'>
                  Disabled drains keep their cursor and resume where they left off.
                </p>
              </div>
              <Switch
                id='data-drain-enabled'
                checked={drain.enabled}
                onCheckedChange={handleToggleEnabled}
                disabled={updateDrain.isPending}
              />
            </div>
          </SettingsSection>

          <SettingsSection label='Schedule'>
            <div className='flex flex-col gap-3'>
              <DetailRow label='Source'>{SOURCE_LABELS[drain.source]}</DetailRow>
              <DetailRow label='Cadence'>{CADENCE_LABELS[drain.scheduleCadence]}</DetailRow>
              <DetailRow label='Last run'>
                <span suppressHydrationWarning>
                  {drain.lastRunAt ? new Date(drain.lastRunAt).toLocaleString() : 'Never'}
                </span>
              </DetailRow>
              <DetailRow label='Last success'>
                <span suppressHydrationWarning>
                  {drain.lastSuccessAt ? new Date(drain.lastSuccessAt).toLocaleString() : 'Never'}
                </span>
              </DetailRow>
            </div>
          </SettingsSection>

          <SettingsSection label='Destination'>
            <div className='flex flex-col gap-3'>
              <DetailRow label='Type'>{DESTINATION_LABELS[drain.destinationType]}</DetailRow>
              {Object.entries(drain.destinationConfig).map(([key, value]) => (
                <DetailRow key={key} label={humanizeConfigKey(key)}>
                  {formatConfigValue(value)}
                </DetailRow>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection label='Recent runs'>
            {runsLoading ? (
              <SettingsEmptyState variant='inline'>Loading runs...</SettingsEmptyState>
            ) : runs && runs.length > 0 ? (
              <div className='flex flex-col gap-2'>
                {runs.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </div>
            ) : (
              <SettingsEmptyState variant='inline'>No runs yet</SettingsEmptyState>
            )}
          </SettingsSection>
        </div>
      </SettingsPanel>

      <ChipConfirmModal
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        srTitle='Delete drain'
        title='Delete drain'
        text={[
          'Are you sure you want to delete ',
          { text: drain.name, bold: true },
          '? This action cannot be undone.',
        ]}
        confirm={{ label: 'Delete', onClick: handleConfirmDelete }}
      />
    </>
  )
}

const RUN_STATUS_VARIANT = {
  success: 'green',
  failed: 'red',
  running: 'blue',
} as const

function RunRow({ run }: { run: DataDrainRun }) {
  return (
    <div className='flex items-start justify-between gap-4 rounded-lg border border-[var(--border-1)] px-3 py-2 text-caption'>
      <div className='flex min-w-0 flex-col gap-0.5'>
        <div className='flex items-center gap-2'>
          <Badge variant={RUN_STATUS_VARIANT[run.status]} size='sm' dot>
            {run.status}
          </Badge>
          <span className='text-[var(--text-muted)]'>{run.trigger}</span>
          <span className='text-[var(--text-muted)]' suppressHydrationWarning>
            {new Date(run.startedAt).toLocaleString()}
          </span>
        </div>
        {run.error && <div className='break-words text-[var(--text-error)]'>{run.error}</div>}
      </div>
      <div className='flex-shrink-0 text-right text-[var(--text-muted)]'>
        <div className='tabular-nums'>{run.rowsExported.toLocaleString()} rows</div>
        <div className='tabular-nums'>
          {formatFileSize(run.bytesWritten, { includeBytes: true })}
        </div>
      </div>
    </div>
  )
}
