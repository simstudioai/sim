'use client'

import { useState } from 'react'
import { ChipTag } from '@sim/emcn'
import { ArrowRight, Database, Plus } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import {
  dataDrainIdParam,
  dataDrainIdUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { DataDrainCreate } from '@/ee/data-drains/components/data-drain-create'
import { DataDrainDetail } from '@/ee/data-drains/components/data-drain-detail'
import { useDataDrains } from '@/ee/data-drains/hooks/data-drains'
import { CADENCE_LABELS, DESTINATION_LABELS, SOURCE_LABELS } from '@/ee/data-drains/labels'

interface DataDrainsSettingsProps {
  organizationId: string
}

export function DataDrainsSettings({ organizationId }: DataDrainsSettingsProps) {
  const { data: drains, isPending, error } = useDataDrains(organizationId)

  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [selectedDrainId, setSelectedDrainId] = useQueryState(dataDrainIdParam.key, {
    ...dataDrainIdParam.parser,
    ...dataDrainIdUrlKeys,
  })
  /** The create flow has no entity id and is not deep-linkable — stays local. */
  const [isCreating, setIsCreating] = useState(false)

  const selectedDrain = selectedDrainId ? drains?.find((d) => d.id === selectedDrainId) : undefined

  const closeDetail = () => {
    setIsCreating(false)
    void setSelectedDrainId(null, { history: 'replace' })
  }

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

  const actions: SettingsAction[] = [
    {
      text: 'Create drain',
      icon: Plus,
      variant: 'primary',
      onSelect: () => setIsCreating(true),
      disabled: isPending,
    },
  ]

  /**
   * Hold the first paint while a deep-linked id could still resolve, so a valid
   * link never flashes the list before jumping to it. A dead id still falls back
   * to the list.
   */
  if (selectedDrainId !== null && isPending) return null

  if (isCreating) {
    return (
      <DataDrainCreate
        organizationId={organizationId}
        onBack={() => setIsCreating(false)}
        onCreated={(drainId) => {
          setIsCreating(false)
          void setSelectedDrainId(drainId)
        }}
      />
    )
  }

  if (selectedDrain) {
    return (
      <DataDrainDetail
        key={selectedDrain.id}
        organizationId={organizationId}
        drain={selectedDrain}
        onBack={closeDetail}
      />
    )
  }

  return (
    <SettingsPanel
      actions={actions}
      search={{
        value: searchTerm,
        onChange: setSearchTerm,
        placeholder: 'Search data drains...',
        disabled: isPending,
      }}
    >
      {error ? (
        <div className='flex h-full flex-col items-center justify-center gap-2'>
          <p className='text-[var(--text-error)] text-sm leading-tight'>
            {getErrorMessage(error, "Couldn't load data drains")}
          </p>
        </div>
      ) : isPending ? null : drains && drains.length > 0 ? (
        <div className='-mx-2 flex flex-col gap-y-0.5'>
          {filteredDrains.map((drain) => (
            <button
              key={drain.id}
              type='button'
              onClick={() => void setSelectedDrainId(drain.id)}
              className='w-full rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
            >
              <SettingsResourceRow
                icon={<Database className='text-[var(--text-icon)]' />}
                iconFilled
                title={drain.name}
                description={
                  <>
                    {`${SOURCE_LABELS[drain.source]} → ${DESTINATION_LABELS[drain.destinationType]} · ${CADENCE_LABELS[drain.scheduleCadence]} · `}
                    <span suppressHydrationWarning>
                      {drain.lastRunAt
                        ? `Last run ${new Date(drain.lastRunAt).toLocaleDateString()}`
                        : 'Never run'}
                    </span>
                  </>
                }
                trailing={
                  <div className='flex flex-shrink-0 items-center gap-2'>
                    {!drain.enabled && <ChipTag variant='gray'>Disabled</ChipTag>}
                    <ArrowRight className='size-4 text-[var(--text-icon)]' />
                  </div>
                }
              />
            </button>
          ))}
          {filteredDrains.length === 0 && (
            <SettingsEmptyState variant='inline'>
              No drains found matching "{searchTerm}"
            </SettingsEmptyState>
          )}
        </div>
      ) : (
        <SettingsEmptyState>Click "Create drain" above to get started</SettingsEmptyState>
      )}
    </SettingsPanel>
  )
}
