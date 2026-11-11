'use client'

import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow } from '@sim/emcn/settings-section'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { DrainCreate } from '@/app/(product)/o/[organizationId]/settings/_components/sections/data-drains/drain-create'
import { DrainDetail } from '@/app/(product)/o/[organizationId]/settings/_components/sections/data-drains/drain-detail'
import {
  CADENCE_LABELS,
  DESTINATION_LABELS,
  SOURCE_LABELS,
  useDataDrains,
  useSettingsSearch,
} from '@/platform/lib/data/data-drains'
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'
import { formatTimestamp } from '@/platform/shared/time'

export default function DataDrainsSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const drainsQuery = useDataDrains(organizationId)
  const { data: drains, isPending } = drainsQuery
  const [search, setSearch] = useSettingsSearch()
  const subview = useSettingsSubview({ idParam: 'data-drain-id', createParam: 'create-data-drain' })
  const selected = subview.id ? drains?.find((drain) => drain.id === subview.id) : undefined

  /** A valid deep link never flashes the list before jumping to it; a dead id falls back to it. */
  if (subview.id !== null && isPending) return null

  if (subview.creating) {
    return (
      <DrainCreate
        organizationId={organizationId}
        onBack={subview.close}
        onCreated={subview.showCreated}
      />
    )
  }
  if (selected) {
    return (
      <DrainDetail
        key={selected.id}
        organizationId={organizationId}
        drain={selected}
        onBack={subview.close}
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

  const createDrain = (
    <Button size='compact' icon='I074' onClick={subview.create}>
      Create drain
    </Button>
  )

  return (
    <SectionStack>
      <SettingsPageHeader />
      {drains && drains.length > 0 && (
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
      )}
      <SettingsRead query={drainsQuery} failureMessage='Couldn’t load data drains'>
        {(drains) => (
          <SettingsList
            title='Data drains'
            empty={
              drains.length === 0
                ? {
                    title: 'No data drains yet',
                    description: 'Export logs, chats and runs to your own storage on a schedule',
                    action: createDrain,
                  }
                : filtered.length === 0
                  ? { title: 'No matching drains' }
                  : undefined
            }
          >
            <ResourceList>
              {filtered.map((drain) => (
                <ActivityRow
                  key={drain.id}
                  title={drain.name}
                  detail={`${SOURCE_LABELS[drain.source]} → ${DESTINATION_LABELS[drain.destinationType]} · ${CADENCE_LABELS[drain.scheduleCadence]} · ${drain.lastRunAt ? `Last run ${formatTimestamp(new Date(drain.lastRunAt).getTime())}` : 'Never run'}`}
                  textMetadata={drain.enabled ? undefined : 'Disabled'}
                  onOpen={() => subview.open(drain.id)}
                />
              ))}
            </ResourceList>
            <SettingsRow
              label='New data drain'
              description='Export logs, chats and runs to your own storage on a schedule'
            >
              {createDrain}
            </SettingsRow>
          </SettingsList>
        )}
      </SettingsRead>
    </SectionStack>
  )
}
