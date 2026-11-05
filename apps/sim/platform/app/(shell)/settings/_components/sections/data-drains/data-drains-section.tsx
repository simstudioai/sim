'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import {
  LoadingState,
  QueryErrorState,
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { DrainCreate } from '@/platform/app/(shell)/settings/_components/sections/data-drains/drain-create'
import { DrainDetail } from '@/platform/app/(shell)/settings/_components/sections/data-drains/drain-detail'
import { ActivityRow, Button, EmptyState, SearchField } from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import {
  CADENCE_LABELS,
  DESTINATION_LABELS,
  SOURCE_LABELS,
  useDataDrainParam,
  useDataDrains,
  useSettingsSearch,
} from '@/platform/lib/data/data-drains'
import { formatTimestamp } from '@/platform/lib/time'

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
            placeholder='Search data drains...'
            value={search}
            onValueChange={setSearch}
          />
        }
      >
        <Button
          variant='primary'
          icon='I074'
          disabled={isPending}
          onClick={() => setCreating(true)}
        >
          Create drain
        </Button>
      </SectionToolbar>
      {error ? (
        <QueryErrorState
          message={getErrorMessage(error, "Couldn't load data drains")}
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
      ) : isPending ? (
        <LoadingState label='Loading data drains…' />
      ) : drains && drains.length > 0 ? (
        filtered.length > 0 ? (
          <SettingsSection title='Data drains'>
            <ResourceList>
              {filtered.map((drain) => (
                <ActivityRow
                  key={drain.id}
                  title={drain.name}
                  detail={`${SOURCE_LABELS[drain.source]} → ${DESTINATION_LABELS[drain.destinationType]} · ${CADENCE_LABELS[drain.scheduleCadence]} · ${drain.lastRunAt ? `Last run ${formatTimestamp(new Date(drain.lastRunAt).getTime())}` : 'Never run'}`}
                  metadata={drain.enabled ? undefined : 'Disabled'}
                  onOpen={() => void setSelectedId(drain.id)}
                />
              ))}
            </ResourceList>
          </SettingsSection>
        ) : (
          <EmptyState title={`No drains found matching "${search}"`} />
        )
      ) : (
        <EmptyState title='No data drains yet' description='Create a drain to get started.' />
      )}
    </SectionStack>
  )
}
