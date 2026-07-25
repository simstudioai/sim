'use client'

import { useState } from 'react'
import {
  Badge,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
  cn,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { ChevronDown, Plus } from 'lucide-react'
import type { CreateDataDrainBody, DataDrain, DataDrainRun } from '@/lib/api/contracts/data-drains'
import { CADENCE_TYPES, DESTINATION_TYPES, SOURCE_TYPES } from '@/lib/data-drains/types'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { DESTINATION_FORM_REGISTRY } from '@/ee/data-drains/destinations/registry'
import {
  useCreateDataDrain,
  useDataDrainRuns,
  useDataDrains,
  useDeleteDataDrain,
  useRunDataDrainNow,
  useTestDataDrain,
  useUpdateDataDrain,
} from '@/ee/data-drains/hooks/data-drains'

const logger = createLogger('DataDrainsSettings')

const SOURCE_LABELS: Record<(typeof SOURCE_TYPES)[number], string> = {
  workflow_logs: 'Workflow logs',
  job_logs: 'Job logs',
  audit_logs: 'Audit logs',
  copilot_chats: 'Chats',
  copilot_runs: 'Chat runs',
}

const DESTINATION_LABELS: Record<(typeof DESTINATION_TYPES)[number], string> = {
  s3: 'Amazon S3',
  gcs: 'Google Cloud Storage',
  azure_blob: 'Azure Blob Storage',
  datadog: 'Datadog',
  bigquery: 'Google BigQuery',
  snowflake: 'Snowflake',
  webhook: 'HTTPS webhook',
}

const CADENCE_LABELS: Record<(typeof CADENCE_TYPES)[number], string> = {
  hourly: 'Every hour',
  daily: 'Every day',
}

const SOURCE_OPTIONS = SOURCE_TYPES.map((t) => ({ value: t, label: SOURCE_LABELS[t] }))
const CADENCE_OPTIONS = CADENCE_TYPES.map((t) => ({ value: t, label: CADENCE_LABELS[t] }))

const DESTINATION_OPTIONS = DESTINATION_TYPES.map((t) => ({
  value: t,
  label: DESTINATION_LABELS[t],
}))

interface DataDrainsSettingsProps {
  organizationId: string
}

export function DataDrainsSettings({ organizationId }: DataDrainsSettingsProps) {
  const {
    data: drains,
    isLoading: drainsLoading,
    error: drainsError,
  } = useDataDrains(organizationId)

  const [createOpen, setCreateOpen] = useState(false)
  const [expandedDrainId, setExpandedDrainId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useSettingsSearch()

  const query = searchTerm.trim().toLowerCase()
  const filteredDrains = !query
    ? (drains ?? [])
    : (drains ?? []).filter((drain) =>
        [
          drain.name,
          SOURCE_LABELS[drain.source],
          DESTINATION_LABELS[drain.destinationType],
          CADENCE_LABELS[drain.scheduleCadence],
        ].some((value) => value.toLowerCase().includes(query))
      )

  if (drainsLoading) return null

  return (
    <>
      <SettingsPanel
        actions={[
          {
            text: 'New drain',
            icon: Plus,
            variant: 'primary',
            onSelect: () => setCreateOpen(true),
          },
        ]}
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search data drains...',
        }}
      >
        <div className='flex flex-col gap-4.5'>
          <div>
            {drainsError ? (
              <div className='flex h-full flex-col items-center justify-center gap-2'>
                <p className='text-[var(--text-error)] text-sm leading-tight'>
                  Failed to load data drains: {toError(drainsError).message}
                </p>
              </div>
            ) : drains && drains.length > 0 ? (
              filteredDrains.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead>Cadence</TableHead>
                      <TableHead>Last run</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead className='w-[40px]' />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDrains.map((drain) => (
                      <DrainRow
                        key={drain.id}
                        drain={drain}
                        organizationId={organizationId}
                        expanded={expandedDrainId === drain.id}
                        onToggleExpand={() =>
                          setExpandedDrainId(expandedDrainId === drain.id ? null : drain.id)
                        }
                      />
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <SettingsEmptyState variant='inline'>
                  No results for "{searchTerm.trim()}"
                </SettingsEmptyState>
              )
            ) : (
              <SettingsEmptyState>Click "New drain" above to get started</SettingsEmptyState>
            )}
          </div>
        </div>
      </SettingsPanel>

      {createOpen && (
        <CreateDrainModal organizationId={organizationId} onClose={() => setCreateOpen(false)} />
      )}
    </>
  )
}

interface DrainRowProps {
  drain: DataDrain
  organizationId: string
  expanded: boolean
  onToggleExpand: () => void
}

function DrainRow({ drain, organizationId, expanded, onToggleExpand }: DrainRowProps) {
  const updateMutation = useUpdateDataDrain()
  const deleteMutation = useDeleteDataDrain()
  const runMutation = useRunDataDrainNow()
  const testMutation = useTestDataDrain()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  async function handleToggleEnabled() {
    try {
      await updateMutation.mutateAsync({
        organizationId,
        drainId: drain.id,
        body: { enabled: !drain.enabled },
      })
      toast.success(drain.enabled ? 'Drain disabled' : 'Drain enabled')
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  async function handleRunNow() {
    try {
      await runMutation.mutateAsync({ organizationId, drainId: drain.id })
      toast.success('Drain run enqueued')
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  async function handleTest() {
    try {
      await testMutation.mutateAsync({ organizationId, drainId: drain.id })
      toast.success('Connection test succeeded')
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  function handleDelete() {
    setShowDeleteConfirm(true)
  }

  async function handleConfirmDelete() {
    try {
      setShowDeleteConfirm(false)
      await deleteMutation.mutateAsync({ organizationId, drainId: drain.id })
      toast.success('Drain deleted')
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  return (
    <>
      <TableRow className='cursor-pointer' onClick={onToggleExpand}>
        <TableCell className='font-medium'>
          <div className='flex items-center gap-1.5'>
            <ChevronDown
              className={cn(
                'size-[14px] flex-shrink-0 text-[var(--text-muted)] transition-transform duration-200',
                expanded && 'rotate-180'
              )}
            />
            <span>{drain.name}</span>
          </div>
        </TableCell>
        <TableCell>
          <Badge>{SOURCE_LABELS[drain.source]}</Badge>
        </TableCell>
        <TableCell>
          <Badge>{DESTINATION_LABELS[drain.destinationType]}</Badge>
        </TableCell>
        <TableCell>{CADENCE_LABELS[drain.scheduleCadence]}</TableCell>
        <TableCell className='text-[var(--text-muted)] text-small' suppressHydrationWarning>
          {drain.lastRunAt ? new Date(drain.lastRunAt).toLocaleString() : 'Never'}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={drain.enabled}
            onCheckedChange={handleToggleEnabled}
            disabled={updateMutation.isPending}
          />
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <RowActionsMenu
            label='Drain actions'
            actions={[
              { label: 'Run now', onSelect: handleRunNow, disabled: !drain.enabled },
              { label: 'Test connection', onSelect: handleTest },
              { label: 'Delete', onSelect: handleDelete, destructive: true },
            ]}
          />
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className='bg-[var(--surface-muted)] p-4'>
            <DrainRunsPanel organizationId={organizationId} drainId={drain.id} />
          </TableCell>
        </TableRow>
      )}
      <ChipConfirmModal
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        srTitle='Delete Drain'
        title='Delete Drain'
        text={[
          'Are you sure you want to delete ',
          { text: drain.name, bold: true },
          '? This action cannot be undone.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleConfirmDelete,
          pending: deleteMutation.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}

interface DrainRunsPanelProps {
  organizationId: string
  drainId: string
}

function DrainRunsPanel({ organizationId, drainId }: DrainRunsPanelProps) {
  const { data: runs, isLoading } = useDataDrainRuns(organizationId, drainId, 10)

  if (isLoading) {
    return <div className='text-[var(--text-muted)] text-small'>Loading runs...</div>
  }
  if (!runs || runs.length === 0) {
    return <div className='text-[var(--text-muted)] text-small'>No runs yet.</div>
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='font-medium text-[var(--text-primary)] text-small'>Recent runs</div>
      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </div>
  )
}

function RunRow({ run }: { run: DataDrainRun }) {
  const statusColor =
    run.status === 'success'
      ? 'text-[var(--text-success)]'
      : run.status === 'failed'
        ? 'text-[var(--text-error)]'
        : 'text-[var(--text-muted)]'
  return (
    <div className='flex items-start justify-between gap-4 rounded-lg border border-[var(--border)] px-3 py-2 text-caption'>
      <div className='flex flex-col gap-0.5'>
        <div className='flex items-center gap-2'>
          <span className={cn('font-medium', statusColor)}>{run.status}</span>
          <span className='text-[var(--text-muted)]'>{run.trigger}</span>
          <span className='text-[var(--text-muted)]' suppressHydrationWarning>
            {new Date(run.startedAt).toLocaleString()}
          </span>
        </div>
        {run.error && <div className='text-[var(--text-error)]'>{run.error}</div>}
      </div>
      <div className='text-right text-[var(--text-muted)]'>
        <div>{run.rowsExported.toLocaleString()} rows</div>
        <div>{(run.bytesWritten / 1024).toFixed(1)} KB</div>
      </div>
    </div>
  )
}

interface CreateDrainModalProps {
  organizationId: string
  onClose: () => void
}

function CreateDrainModal({ organizationId, onClose }: CreateDrainModalProps) {
  const createMutation = useCreateDataDrain()

  const [name, setName] = useState('')
  const [source, setSource] = useState<(typeof SOURCE_TYPES)[number]>('workflow_logs')
  const [cadence, setCadence] = useState<(typeof CADENCE_TYPES)[number]>('daily')
  const [destinationType, setDestinationType] = useState<(typeof DESTINATION_TYPES)[number]>(
    DESTINATION_TYPES[0]
  )
  const [destState, setDestState] = useState<unknown>(
    () => DESTINATION_FORM_REGISTRY[DESTINATION_TYPES[0]].initialState
  )
  const [submitError, setSubmitError] = useState<string | null>(null)

  const spec = DESTINATION_FORM_REGISTRY[destinationType]
  const canSubmit = name.trim().length > 0 && spec.isComplete(destState)

  function handleDestinationChange(next: (typeof DESTINATION_TYPES)[number]) {
    setDestinationType(next)
    setDestState(DESTINATION_FORM_REGISTRY[next].initialState)
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitError(null)
    try {
      const body = {
        name: name.trim(),
        source,
        scheduleCadence: cadence,
        ...spec.toDestinationBranch(destState),
      } as CreateDataDrainBody
      await createMutation.mutateAsync({ organizationId, body })
      toast.success('Drain created')
      onClose()
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to create data drain', { error: msg })
      setSubmitError(msg)
    }
  }

  return (
    <ChipModal open onOpenChange={(open) => !open && onClose()} srTitle='New data drain' size='md'>
      <ChipModalHeader onClose={() => onClose()}>New data drain</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Name'
          value={name}
          onChange={setName}
          placeholder='Workflow logs export'
          required
        />
        <ChipModalField type='custom' title='Source'>
          <ChipSelect
            value={source}
            onChange={(v) => setSource(v as (typeof SOURCE_TYPES)[number])}
            options={SOURCE_OPTIONS}
            align='start'
          />
        </ChipModalField>
        <ChipModalField type='custom' title='Cadence'>
          <ChipSelect
            value={cadence}
            onChange={(v) => setCadence(v as (typeof CADENCE_TYPES)[number])}
            options={CADENCE_OPTIONS}
            align='start'
          />
        </ChipModalField>
        <ChipModalField type='custom' title='Destination'>
          <ChipSelect
            value={destinationType}
            onChange={(v) => handleDestinationChange(v as (typeof DESTINATION_TYPES)[number])}
            options={DESTINATION_OPTIONS}
            displayLabel={DESTINATION_LABELS[destinationType]}
            align='start'
          />
        </ChipModalField>

        <section className='flex flex-col gap-4 px-2'>
          <spec.FormFields state={destState} setState={setDestState} />
        </section>
        <ChipModalError>{submitError}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        cancelDisabled={createMutation.isPending}
        primaryAction={{
          label: createMutation.isPending ? 'Creating...' : 'Create drain',
          onClick: handleSubmit,
          disabled: !canSubmit || createMutation.isPending,
        }}
      />
    </ChipModal>
  )
}
