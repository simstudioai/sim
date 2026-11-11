'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { DrainCreate } from '@/app/(product)/o/[organizationId]/settings/_components/sections/data-drains/drain-create'
import { DrainDetail } from '@/app/(product)/o/[organizationId]/settings/_components/sections/data-drains/drain-detail'
import {
  CADENCE_LABELS,
  DESTINATION_LABELS,
  SOURCE_LABELS,
  useDataDrainParam,
  useDataDrains,
  useSettingsSearch,
} from '@/platform/lib/data/data-drains'
import { formatTimestamp } from '@/platform/shared/time'

export default function DataDrainsSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const { data: drains, isPending, error, isFetching, refetch } = useDataDrains(organizationId)
  const [search, setSearch] = useSettingsSearch()
  const [selectedId, setSelectedId] = useDataDrainParam()
  /** The create flow has no entity id and is not deep-linkable, so it stays local. */
  const [creating, setCreating] = useState(false)
  const selected = selectedId ? drains?.find((drain) => drain.id === selectedId) : undefined

  /** A valid deep link never flashes the list before jumping to it; a dead id falls back to it. */
  if (selectedId !== null && isPending) return null

  if (creating) {
    return (
      <DrainCreate
        organizationId={organizationId}
        onBack={() => setCreating(false)}
        onCreated={(drainId) => {
          setCreating(false)
          void setSelectedId(drainId)
        }}
      />
    )
  }
  if (selected) {
    return (
      <DrainDetail
        key={selected.id}
        organizationId={organizationId}
        drain={selected}
        onBack={() => void setSelectedId(null, { history: 'replace' })}
      />
    )
  }

  const query = search.trim().toLowerCase()
  const filtered = (drains ?? []).filter(
    (drain) =>
      !query ||
      [
        drain.name,
        SOURCE_LABELS[drain.source],
        DESTINATION_LABELS[drain.destinationType],
        CADENCE_LABELS[drain.scheduleCadence],
      ].some((value) => value.toLowerCase().includes(query))
  )

  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SearchField
            label='Search data drains'
            placeholder='Search data drains…'
            value={search}
            onValueChange={setSearch}
          />
        }
      />
      <SettingsSection title='Data drains'>
        {error ? (
          <FailureNotice
            message={getErrorMessage(error, "Couldn't load data drains")}
            retrying={isFetching}
            onRetry={() => void refetch()}
          />
        ) : isPending ? null : drains && drains.length > 0 ? (
          filtered.length > 0 ? (
            <ResourceList>
              {filtered.map((drain) => (
                <ActivityRow
                  key={drain.id}
                  title={drain.name}
                  detail={`${SOURCE_LABELS[drain.source]} → ${DESTINATION_LABELS[drain.destinationType]} · ${CADENCE_LABELS[drain.scheduleCadence]} · ${drain.lastRunAt ? `Last run ${formatTimestamp(new Date(drain.lastRunAt).getTime())}` : 'Never run'}`}
                  textMetadata={drain.enabled ? undefined : 'Disabled'}
                  onOpen={() => void setSelectedId(drain.id)}
                />
              ))}
            </ResourceList>
          ) : (
            <EmptyState title='No matching drains' />
          )
        ) : (
          <EmptyState title='No data drains yet' description='Create a drain to get started.' />
        )}
        <SettingsRow
          label='New data drain'
          description='Export logs, chats and runs to your own storage on a schedule'
        >
          <Button size='compact' icon='I074' disabled={isPending} onClick={() => setCreating(true)}>
            Create drain
          </Button>
        </SettingsRow>
      </SettingsSection>
    </SectionStack>
  )
}
