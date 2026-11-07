import type { IconName } from '@/platform/design-system/catalog/icon-geometry'

export interface ShellItem {
  id: string
  title: string
}

/** `value` is absolute when the destination stays on another surface. */
export interface ShellDestination {
  id: string
  label: string
  icon: IconName
  value: string
}

export type ShellQueryStatus = 'pending' | 'error' | 'success'
