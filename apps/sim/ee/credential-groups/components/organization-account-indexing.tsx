'use client'

import { ChipSwitch } from '@sim/emcn'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'
import { useUpdateOrganizationAccountIndexing } from '@/hooks/queries/organization-account-indexing'

interface OrganizationAccountIndexingProps {
  organizationId: string
  optionId: string
  providerName: string
  sources: SearchSourceSummary[]
  available: boolean
  disabled: boolean
  onSetup: () => void
}

export function OrganizationAccountIndexing({
  organizationId,
  optionId,
  providerName,
  sources,
  available,
  disabled,
  onSetup,
}: OrganizationAccountIndexingProps) {
  const update = useUpdateOrganizationAccountIndexing()
  const enabled = sources.some((source) => source.enabled)
  const cannotEnable = !available && !enabled
  return (
    <div className='flex flex-col items-start gap-1'>
      <fieldset
        disabled={disabled || update.isPending || cannotEnable}
        className='flex items-center gap-2'
      >
        <legend className='sr-only'>{providerName} indexing</legend>
        <ChipSwitch
          aria-label={`${providerName} indexing`}
          value={enabled ? 'on' : 'off'}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
          onChange={(value) => {
            if (value === 'on' && !sources.length) onSetup()
            else update.mutate({ organizationId, optionId, enabled: value === 'on' })
          }}
        />
      </fieldset>
      {cannotEnable && (
        <span className='text-[var(--text-muted)] text-caption'>Search is not enabled</span>
      )}
      {update.error && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {update.error.message}
        </p>
      )}
    </div>
  )
}
