'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { PropertyList } from '@sim/emcn/property-list'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { toError } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  DetailHeader,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import {
  CADENCE_LABELS,
  type DataDrain,
  type DataDrainRun,
  DESTINATION_LABELS,
  formatFileSize,
  SOURCE_LABELS,
  useDataDrainRuns,
  useDeleteDataDrain,
  useRunDataDrainNow,
  useTestDataDrain,
  useUpdateDataDrain,
} from '@/platform/lib/data/data-drains'
import { formatTimestamp, LOCALE } from '@/platform/shared/time'

const RECENT_RUN_LIMIT = 10

/** Rendered generically so a new destination's config needs no formatter. */
function formatConfigValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

const CONFIG_KEY_ACRONYMS: Record<string, string> = {
  id: 'ID',
  url: 'URL',
  json: 'JSON',
  api: 'API',
}

/** `forcePathStyle` → `Force path style`, sentence case so a new field needs no label map. */
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

/** A run's status in the Logs vocabulary. */
const RUN_STATUS = {
  success: { label: 'Completed', intent: 'success' },
  failed: { label: 'Failed', intent: 'danger' },
  running: { label: 'Running', intent: 'info' },
} as const

const RUN_TRIGGER_LABELS: Record<DataDrainRun['trigger'], string> = {
  cron: 'Scheduled',
  manual: 'Manual',
}

function RunRow({ run }: { run: DataDrainRun }) {
  const status = RUN_STATUS[run.status]
  return (
    <SettingsRow
      label={formatTimestamp(new Date(run.startedAt).getTime())}
      description={[
        RUN_TRIGGER_LABELS[run.trigger],
        `${run.rowsExported.toLocaleString(LOCALE)} rows`,
        formatFileSize(run.bytesWritten, { includeBytes: true }),
        run.error,
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <StatusTag label={status.label} intent={status.intent} />
    </SettingsRow>
  )
}

interface DrainDetailProps {
  organizationId: string
  drain: DataDrain
  onBack: () => void
}

/**
 * One drain. Only the enabled toggle is editable: destination credentials are never returned, so
 * changing one means recreating the drain.
 */
export function DrainDetail({ organizationId, drain, onBack }: DrainDetailProps) {
  const updateDrain = useUpdateDataDrain()
  const deleteDrain = useDeleteDataDrain()
  const runDrain = useRunDataDrainNow()
  const testDrain = useTestDataDrain()
  const runs = useDataDrainRuns(organizationId, drain.id, RECENT_RUN_LIMIT)
  // The runs query keeps previous data, which would read as another drain's history.
  const runsLoading = runs.isPending || runs.isPlaceholderData
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function report(work: Promise<unknown>, success: string) {
    try {
      await work
      toast.success(success)
    } catch (error) {
      toast.error(toError(error).message)
    }
  }

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Data drains'
        onBack={onBack}
        title={drain.name}
        description={`${SOURCE_LABELS[drain.source]} → ${DESTINATION_LABELS[drain.destinationType]} · ${CADENCE_LABELS[drain.scheduleCadence]}`}
      />
      <SettingsSection title='Status'>
        <SwitchRow
          label='Enabled'
          description='Disabled drains keep their place and resume where they left off'
          checked={drain.enabled}
          disabled={updateDrain.isPending}
          onCheckedChange={() =>
            void report(
              updateDrain.mutateAsync({
                organizationId,
                drainId: drain.id,
                body: { enabled: !drain.enabled },
              }),
              drain.enabled ? 'Drain disabled' : 'Drain enabled'
            )
          }
        />
      </SettingsSection>
      <SettingsSection title='Schedule'>
        <FieldStack>
          <PropertyList
            titleHidden
            title='Schedule details'
            properties={[
              { id: 'source', label: 'Source', kind: 'text', value: SOURCE_LABELS[drain.source] },
              {
                id: 'cadence',
                label: 'Cadence',
                kind: 'text',
                value: CADENCE_LABELS[drain.scheduleCadence],
              },
              {
                id: 'last-run',
                label: 'Last run',
                kind: 'text',
                value: drain.lastRunAt
                  ? formatTimestamp(new Date(drain.lastRunAt).getTime())
                  : 'Never',
              },
              {
                id: 'last-success',
                label: 'Last success',
                kind: 'text',
                value: drain.lastSuccessAt
                  ? formatTimestamp(new Date(drain.lastSuccessAt).getTime())
                  : 'Never',
              },
            ]}
          />
        </FieldStack>
        <SettingsRow
          label='Manual export'
          description={
            drain.enabled ? 'Export now, outside the schedule' : 'Enable the drain to run it'
          }
        >
          <Button
            disabled={!drain.enabled || runDrain.isPending}
            onClick={() =>
              void report(runDrain.mutateAsync({ organizationId, drainId: drain.id }), 'Run queued')
            }
          >
            Run now
          </Button>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title='Destination'>
        <FieldStack>
          <PropertyList
            titleHidden
            title='Destination details'
            properties={[
              {
                id: 'type',
                label: 'Type',
                kind: 'text',
                value: DESTINATION_LABELS[drain.destinationType],
              },
              ...Object.entries(drain.destinationConfig).map(([key, value]) => ({
                id: key,
                label: humanizeConfigKey(key),
                kind: 'text' as const,
                value: formatConfigValue(value),
              })),
            ]}
          />
        </FieldStack>
        <SettingsRow label='Connection' description='Check that Sim can reach the destination'>
          <Button
            disabled={testDrain.isPending}
            onClick={() =>
              void report(
                testDrain.mutateAsync({ organizationId, drainId: drain.id }),
                'Connection test passed'
              )
            }
          >
            Test connection
          </Button>
        </SettingsRow>
      </SettingsSection>
      {runsLoading ? null : runs.data === undefined ? (
        <FailureNotice
          message={toError(runs.error).message}
          retrying={runs.isFetching}
          onRetry={() => void runs.refetch()}
        />
      ) : (
        <SettingsList
          title='Recent runs'
          empty={runs.data.length === 0 ? { title: 'No runs yet' } : undefined}
        >
          {runs.data.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </SettingsList>
      )}
      <SettingsSection title='Manage drain'>
        <SettingsRow label='Delete drain' description='Stop exporting and remove this drain'>
          <Button variant='quiet' destructive onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        </SettingsRow>
      </SettingsSection>
      <ConfirmDialog
        target={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={`Delete ${drain.name}`}
        description='Exports stop and the drain is removed. This can’t be undone'
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async () => {
          await deleteDrain.mutateAsync({ organizationId, drainId: drain.id })
          toast.success('Drain deleted')
          onBack()
        }}
      />
    </SectionStack>
  )
}
