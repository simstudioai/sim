'use client'

import { SearchableSelect } from '@/platform/design-system/components'

interface ContentCredentialFieldProps {
  credentialId: string | null
  onChange: (credentialId: string | null) => void
  options: readonly { value: string; label: string }[]
  loading?: boolean
  disabled?: boolean
}

const CONNECTED_MEMBERS = '__connected_members__'

/** A dedicated source account supplies content; member accounts supply visibility only. */
export function ContentCredentialField({
  credentialId,
  onChange,
  options,
  loading,
  disabled,
}: ContentCredentialFieldProps) {
  return (
    <SearchableSelect
      label='Sync documents with'
      searchLabel='Search accounts…'
      placeholder='Choose an account'
      value={credentialId ?? CONNECTED_MEMBERS}
      options={[{ value: CONNECTED_MEMBERS, label: 'Connected members' }, ...options]}
      onValueChange={(value) => onChange(value === CONNECTED_MEMBERS ? null : value)}
      disabled={disabled || loading}
      hint={loading ? 'Loading accounts…' : undefined}
    />
  )
}
