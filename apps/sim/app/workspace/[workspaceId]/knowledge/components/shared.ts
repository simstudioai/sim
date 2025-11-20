export const filterButtonClass =
  'w-full justify-between rounded-[10px] border-[#E5E5E5] bg-[var(--white)] font-normal text-sm dark:border-[#414141] dark:bg-[var(--surface-elevated)]'

export const dropdownContentClass =
  'w-[220px] rounded-lg border-[#E5E5E5] bg-[var(--white)] p-0 shadow-xs dark:border-[#414141] dark:bg-[var(--surface-elevated)]'

export const commandListClass = 'overflow-y-auto overflow-x-hidden'

export type SortOption = 'name' | 'createdAt' | 'updatedAt' | 'docCount'
export type SortOrder = 'asc' | 'desc'

export const SORT_OPTIONS = [
  { value: 'updatedAt-desc', label: 'Last Updated' },
  { value: 'createdAt-desc', label: 'Newest First' },
  { value: 'createdAt-asc', label: 'Oldest First' },
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'docCount-desc', label: 'Most Documents' },
  { value: 'docCount-asc', label: 'Least Documents' },
] as const
