'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { ChevronDown, Plus, Search } from 'lucide-react'
import {
  Badge,
  Button,
  Callout,
  Combobox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FormField,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  MoreHorizontal,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@/components/emcn'
import {
  AzureIcon,
  BigQueryIcon,
  DatadogIcon,
  GoogleIcon,
  S3Icon,
  SnowflakeIcon,
} from '@/components/icons'
import { Input as BaseInput } from '@/components/ui'
import type { CreateDataDrainBody, DataDrain, DataDrainRun } from '@/lib/api/contracts/data-drains'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import { CADENCE_TYPES, DESTINATION_TYPES, SOURCE_TYPES } from '@/lib/data-drains/types'
import { getUserRole } from '@/lib/workspaces/organization/utils'
import { DataDrainsSkeleton } from '@/ee/data-drains/components/data-drains-skeleton'
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
import { useOrganizations } from '@/hooks/queries/organization'

const logger = createLogger('DataDrainsSettings')

const SOURCE_LABELS: Record<(typeof SOURCE_TYPES)[number], string> = {
  workflow_logs: 'Workflow logs',
  job_logs: 'Job logs',
  audit_logs: 'Audit logs',
  copilot_chats: 'Copilot chats',
  copilot_runs: 'Copilot runs',
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
function getDestinationIcon(type: (typeof DESTINATION_TYPES)[number]) {
  switch (type) {
    case 's3':
      return <S3Icon className='size-[14px] flex-shrink-0 text-[#1B660F]' />
    case 'gcs':
      return <GoogleIcon className='size-[14px] flex-shrink-0' />
    case 'azure_blob':
      return <AzureIcon className='size-[14px] flex-shrink-0' />
    case 'datadog':
      return <DatadogIcon className='size-[14px] flex-shrink-0' />
    case 'bigquery':
      return <BigQueryIcon className='size-[14px] flex-shrink-0' />
    case 'snowflake':
      return <SnowflakeIcon className='size-[14px] flex-shrink-0' />
    default:
      return null
  }
}

const DESTINATION_OPTIONS = DESTINATION_TYPES.map((t) => ({
  value: t,
  label: DESTINATION_LABELS[t],
  iconElement: getDestinationIcon(t),
}))

export function DataDrainsSettings() {
  const { data: session, isPending: sessionPending } = useSession()
  const { data: orgsData, isLoading: orgsLoading } = useOrganizations()
  const activeOrganization = orgsData?.activeOrganization
  const orgId = activeOrganization?.id

  const userEmail = session?.user?.email
  const userRole = getUserRole(activeOrganization, userEmail)
  const canManage = userRole === 'owner' || userRole === 'admin'

  const { data: drains, isLoading: drainsLoading, error: drainsError } = useDataDrains(orgId)

  const [createOpen, setCreateOpen] = useState(false)
  const [expandedDrainId, setExpandedDrainId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

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

  if (sessionPending || orgsLoading || drainsLoading) {
    return <DataDrainsSkeleton />
  }

  if (!orgId) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        Data drains are configured per organization. Join or create one to continue.
      </div>
    )
  }

  if (!canManage) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        Only organization owners and admins can configure data drains.
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col gap-4.5'>
      <Callout>
        Drains continuously export Sim data to your own storage on a schedule. Combine with Data
        Retention to satisfy long-term compliance archives.
      </Callout>

      <div className='flex items-center gap-2'>
        <div className='flex flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
          <Search
            className='size-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
            strokeWidth={2}
          />
          <BaseInput
            placeholder='Search data drains...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
        <Button variant='primary' onClick={() => setCreateOpen(true)}>
          <Plus className='mr-1.5 size-[13px]' />
          New drain
        </Button>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        {drainsError ? (
          <Callout variant='destructive'>
            Failed to load data drains: {toError(drainsError).message}
          </Callout>
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
                    organizationId={orgId}
                    expanded={expandedDrainId === drain.id}
                    onToggleExpand={() =>
                      setExpandedDrainId(expandedDrainId === drain.id ? null : drain.id)
                    }
                  />
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className='flex h-full items-center justify-center py-12 text-[var(--text-muted)] text-sm'>
              No results for "{searchTerm.trim()}"
            </div>
          )
        ) : (
          <div className='flex h-full items-center justify-center py-12 text-[var(--text-muted)] text-sm'>
            Click "New drain" above to get started
          </div>
        )}
      </div>

      {createOpen && (
        <CreateDrainModal organizationId={orgId} onClose={() => setCreateOpen(false)} />
      )}
    </div>
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

  async function handleDelete() {
    if (!window.confirm(`Delete drain "${drain.name}"? This cannot be undone.`)) return
    try {
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
        <TableCell className='text-[13px] text-[var(--text-muted)]' suppressHydrationWarning>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='sm' aria-label='Drain actions'>
                <MoreHorizontal className='size-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={handleRunNow} disabled={!drain.enabled}>
                Run now
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleTest}>Test connection</DropdownMenuItem>
              <DropdownMenuItem onClick={handleDelete} className='text-red-600'>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className='bg-[var(--surface-muted)] p-4'>
            <DrainRunsPanel organizationId={organizationId} drainId={drain.id} />
          </TableCell>
        </TableRow>
      )}
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
    return <div className='text-[13px] text-[var(--text-muted)]'>Loading runs...</div>
  }
  if (!runs || runs.length === 0) {
    return <div className='text-[13px] text-[var(--text-muted)]'>No runs yet.</div>
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='font-medium text-[13px] text-[var(--text-primary)]'>Recent runs</div>
      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </div>
  )
}

function RunRow({ run }: { run: DataDrainRun }) {
  const statusColor =
    run.status === 'success'
      ? 'text-green-600'
      : run.status === 'failed'
        ? 'text-red-600'
        : 'text-[var(--text-muted)]'
  return (
    <div className='flex items-start justify-between gap-4 rounded border border-[var(--border)] px-3 py-2 text-[12px]'>
      <div className='flex flex-col gap-0.5'>
        <div className='flex items-center gap-2'>
          <span className={cn('font-medium', statusColor)}>{run.status}</span>
          <span className='text-[var(--text-muted)]'>{run.trigger}</span>
          <span className='text-[var(--text-muted)]' suppressHydrationWarning>
            {new Date(run.startedAt).toLocaleString()}
          </span>
        </div>
        {run.error && <div className='text-red-600'>{run.error}</div>}
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

  const spec = DESTINATION_FORM_REGISTRY[destinationType]
  const canSubmit = name.trim().length > 0 && spec.isComplete(destState)

  function handleDestinationChange(next: (typeof DESTINATION_TYPES)[number]) {
    setDestinationType(next)
    setDestState(DESTINATION_FORM_REGISTRY[next].initialState)
  }

  async function handleSubmit() {
    if (!canSubmit) return
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
      toast.error(msg)
    }
  }

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent size='md' className='max-h-[76vh]'>
        <ModalHeader>New data drain</ModalHeader>
        <ModalBody className='flex min-h-0 flex-1 flex-col gap-3'>
          <ModalDescription className='sr-only'>
            Configure a new data drain to export workflow logs to an external destination
          </ModalDescription>
          <section className='flex flex-col gap-3'>
            <FormField label='Name'>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='Workflow logs export'
              />
            </FormField>
            <FormField label='Source'>
              <Combobox
                value={source}
                onChange={(v) => setSource(v as (typeof SOURCE_TYPES)[number])}
                options={SOURCE_OPTIONS}
                dropdownWidth='trigger'
              />
            </FormField>
            <FormField label='Cadence'>
              <Combobox
                value={cadence}
                onChange={(v) => setCadence(v as (typeof CADENCE_TYPES)[number])}
                options={CADENCE_OPTIONS}
                dropdownWidth='trigger'
              />
            </FormField>
            <FormField label='Destination'>
              <Combobox
                value={destinationType}
                onChange={(v) => handleDestinationChange(v as (typeof DESTINATION_TYPES)[number])}
                options={DESTINATION_OPTIONS}
                dropdownWidth='trigger'
                overlayContent={
                  <div className='flex items-center gap-2'>
                    {getDestinationIcon(destinationType)}
                    <span className='truncate text-[var(--text-primary)]'>
                      {DESTINATION_LABELS[destinationType]}
                    </span>
                  </div>
                }
              />
            </FormField>
          </section>

          <section className='flex flex-col gap-3'>
            <spec.FormFields state={destState} setState={setDestState} />
          </section>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant='primary'
            onClick={handleSubmit}
            disabled={!canSubmit || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create drain'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
