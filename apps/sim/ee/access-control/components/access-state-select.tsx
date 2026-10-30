import { ChipDropdown } from '@sim/emcn'
import type { PermissionGroupAccessState } from '@/ee/access-requests/lib/targets'

const ACCESS_OPTIONS = [
  { value: 'allowed', label: 'Allowed' },
  { value: 'requestable', label: 'Can request' },
  { value: 'unavailable', label: 'Unavailable' },
]

interface AccessStateSelectProps {
  label: string
  value: PermissionGroupAccessState
  onChange: (state: PermissionGroupAccessState) => void
  disabled?: boolean
  canRequest?: boolean
}

export function AccessStateSelect({
  label,
  value,
  onChange,
  disabled,
  canRequest = true,
}: AccessStateSelectProps) {
  return (
    <ChipDropdown
      aria-label={`${label}: ${ACCESS_OPTIONS.find((option) => option.value === value)?.label}`}
      value={value}
      onChange={(next) => onChange(next as PermissionGroupAccessState)}
      options={
        canRequest
          ? ACCESS_OPTIONS
          : ACCESS_OPTIONS.filter(
              (option) => option.value !== 'requestable' || (disabled && value === 'requestable')
            )
      }
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

export function BulkAccessSelect({ onChange, disabled, canRequest = true }: BulkAccessSelectProps) {
  return (
    <ChipDropdown
      aria-label='Set shown permissions to'
      placeholder='Set shown to…'
      value=''
      onChange={(next) => onChange(next as PermissionGroupAccessState)}
      options={
        canRequest
          ? ACCESS_OPTIONS
          : ACCESS_OPTIONS.filter((option) => option.value !== 'requestable')
      }
      disabled={disabled}
      matchTriggerWidth={false}
      className='w-[140px] shrink-0 max-sm:min-w-0 max-sm:flex-1'
    />
  )
}
