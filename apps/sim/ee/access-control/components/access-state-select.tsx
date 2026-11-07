import { ChipDropdown } from '@sim/emcn-legacy'
import {
  accessStateLabel,
  accessStateOptions,
  bulkAccessOptions,
} from '@/ee/access-control/lib/editor'
import type { PermissionGroupAccessState } from '@/ee/access-requests/lib/targets'

interface AccessStateSelectProps {
  label: string
  value: PermissionGroupAccessState
  onChange: (state: PermissionGroupAccessState) => void
  disabled?: boolean
  canRequest?: boolean
}

/** Selects a group policy state, retaining unsupported inherited values while disabled. */
export function AccessStateSelect({
  label,
  value,
  onChange,
  disabled,
  canRequest = true,
}: AccessStateSelectProps) {
  return (
    <ChipDropdown
      aria-label={`${label}: ${accessStateLabel(value)}`}
      value={value}
      onChange={(next) => onChange(next as PermissionGroupAccessState)}
      options={accessStateOptions(canRequest, value, disabled)}
      disabled={disabled}
      matchTriggerWidth={false}
      className='w-[132px] shrink-0'
    />
  )
}

interface BulkAccessSelectProps {
  onChange: (state: PermissionGroupAccessState) => void
  disabled?: boolean
  canRequest?: boolean
}

/** Emits a bulk policy choice; the caller selects targets and whether they support requests. */
export function BulkAccessSelect({ onChange, disabled, canRequest = true }: BulkAccessSelectProps) {
  return (
    <ChipDropdown
      aria-label='Set shown permissions to'
      placeholder='Set shown to…'
      value=''
      onChange={(next) => onChange(next as PermissionGroupAccessState)}
      options={bulkAccessOptions(canRequest)}
      disabled={disabled}
      matchTriggerWidth={false}
      className='w-[140px] shrink-0 max-sm:min-w-0 max-sm:flex-1'
    />
  )
}
