'use client'

import { useState } from 'react'
import type { DataDrain, DataDrainRun } from '@/lib/api/contracts/data-drains'
import { formatFileSize } from '@/lib/uploads/utils/file-size'
import { CADENCE_LABELS, DESTINATION_LABELS, SOURCE_LABELS } from '@/ee/data-drains/labels'
import { formatConfigValue, humanizeConfigKey } from '@/ee/data-drains/lib/config-display'
import {
  Button,
  ConfirmDialog,
  EmptyState,
  errorMessageOr,
  PropertyList,
  QueryBoundary,
  StatusTag,
  Switch,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  DetailHeader,
  FieldStack,
  SectionStack,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { useDrainDetail } from '@/platform/embedded/lib/data/drains'
import { formatTimestamp } from '@/platform/shared/time'

const RUN_STATUS_INTENT = { success: 'success', failed: 'danger', running: 'info' } as const

function RunRow({ run }: { run: DataDrainRun }) {
  return (
    <SettingsRow
      label={`${run.rowsExported.toLocaleString()} rows · ${formatFileSize(run.bytesWritten, { includeBytes: true })}`}
      description={`${run.trigger} · ${formatTimestamp(new Date(run.startedAt).getTime())}${run.error ? ` · ${run.error}` : ''}`}
    >
      <StatusTag label={run.status} intent={RUN_STATUS_INTENT[run.status]} />
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
  const detail = useDrainDetail(organizationId, drain)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Data drains'
        onBack={onBack}
        title={drain.name}
        description={`${SOURCE_LABELS[drain.source]} → ${DESTINATION_LABELS[drain.destinationType]} · ${CADENCE_LABELS[drain.scheduleCadence]}`}
      />
      <SettingsSection title='Status'>
        <SettingsRow
          label='Enabled'
          description='Disabled drains keep their cursor and resume where they left off.'
        >
          <Switch
            label='Enabled'
            checked={drain.enabled}
            disabled={detail.updatePending}
            onCheckedChange={detail.toggleEnabled}
          />
        </SettingsRow>
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
        <SettingsRow label='Connection'>
          <Button disabled={detail.testPending} onClick={detail.testConnection}>
            Test connection
          </Button>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title='Recent runs'>
        <SettingsRow
          label='Manual export'
          description={drain.enabled ? undefined : 'Enable the drain to run it.'}
        >
          <Button disabled={!drain.enabled || detail.runPending} onClick={detail.runNow}>
            Run now
          </Button>
        </SettingsRow>
        <QueryBoundary
          query={detail.runs}
          failure={errorMessageOr('Could not load runs')}
          loadingLabel='Loading runs…'
          empty={(data) => data.length === 0 && <EmptyState title='No runs yet' />}
        >
          {(data) => data.map((run) => <RunRow key={run.id} run={run} />)}
        </QueryBoundary>
      </SettingsSection>
      <SettingsSection title='Manage drain'>
        <SettingsRow label='Delete drain'>
          <Button
            variant='destructive'
            disabled={detail.deletePending}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </Button>
        </SettingsRow>
      </SettingsSection>
      <ConfirmDialog
        target={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title='Delete drain'
        description={`Are you sure you want to delete ${drain.name}? This action cannot be undone.`}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async () => {
          await detail.remove()
          onBack()
        }}
      />
    </SectionStack>
  )
}
