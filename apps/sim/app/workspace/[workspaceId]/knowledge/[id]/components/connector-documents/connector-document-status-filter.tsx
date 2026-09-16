'use client'

import { ChipDropdown } from '@sim/emcn'
import type {
  ConnectorDocumentFilter,
  ConnectorDocumentsData,
} from '@/lib/api/contracts/knowledge/connectors'

interface ConnectorDocumentStatusFilterProps {
  filter: ConnectorDocumentFilter
  onFilterChange: (filter: ConnectorDocumentFilter) => void
  counts?: ConnectorDocumentsData['counts']
  isLoading: boolean
}

export function ConnectorDocumentStatusFilter({
  filter,
  onFilterChange,
  counts = { active: 0, excluded: 0, failed: 0, skipped: 0 },
  isLoading,
}: ConnectorDocumentStatusFilterProps) {
  return (
    <ChipDropdown
      aria-label='Document status'
      value={filter}
      onChange={(value) => {
        if (value === 'active' || value === 'excluded' || value === 'failed' || value === 'skipped')
          onFilterChange(value)
      }}
      matchTriggerWidth={false}
      options={[
        { value: 'active', label: isLoading ? 'Included' : `Included (${counts.active})` },
        { value: 'excluded', label: isLoading ? 'Excluded' : `Excluded (${counts.excluded})` },
        { value: 'failed', label: isLoading ? 'Failed' : `Failed (${counts.failed})` },
        { value: 'skipped', label: isLoading ? 'Skipped' : `Skipped (${counts.skipped})` },
      ]}
    />
  )
}
