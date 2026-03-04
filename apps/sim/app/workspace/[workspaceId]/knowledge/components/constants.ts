export const filterButtonClass =
  'w-full justify-between rounded-[10px] border-[#E5E5E5] bg-[var(--white)] font-normal text-sm dark:border-[#414141] dark:bg-[var(--surface-2)]'

export const dropdownContentClass =
  'w-[220px] rounded-lg border-[#E5E5E5] bg-[var(--white)] p-0 shadow-xs dark:border-[#414141] dark:bg-[var(--surface-2)]'

export const commandListClass = 'overflow-y-auto overflow-x-hidden'

export type SortOption = 'name' | 'createdAt' | 'updatedAt' | 'docCount'
export type SortOrder = 'asc' | 'desc'

export const SORT_OPTIONS = [
  { value: 'updatedAt-desc', label: 'knowledge.sort_options.last_updated' },
  { value: 'createdAt-desc', label: 'knowledge.sort_options.newest_first' },
  { value: 'createdAt-asc', label: 'knowledge.sort_options.oldest_first' },
  { value: 'name-asc', label: 'knowledge.sort_options.name_asc' },
  { value: 'name-desc', label: 'knowledge.sort_options.name_desc' },
  { value: 'docCount-desc', label: 'knowledge.sort_options.most_docs' },
  { value: 'docCount-asc', label: 'knowledge.sort_options.least_docs' },
] as const
