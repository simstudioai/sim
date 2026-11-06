'use client'

import { SearchField } from '@/platform/design-system/components/search-field/search-field'

interface SectionSearchProps {
  /** What the section lists, in the plural: "members" reads "Search members…". */
  subject: string
  value?: string
  onValueChange?: (query: string) => void
  maxLength?: number
}

/** The search over one section's own rows. */
export function SectionSearch({ subject, value, onValueChange, maxLength }: SectionSearchProps) {
  return (
    <SearchField
      label={`Search ${subject}`}
      placeholder={`Search ${subject}…`}
      value={value}
      onValueChange={onValueChange}
      maxLength={maxLength}
    />
  )
}
