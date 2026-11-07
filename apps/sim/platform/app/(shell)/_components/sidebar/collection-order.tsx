import { ActionMenu } from '@/platform/design-system/components'

const ORDERS = ['recent', 'ascending', 'descending'] as const
export type SidebarOrder = (typeof ORDERS)[number]

/** The source supplies recency order. Pins form their own group under every preference. */
export function orderSidebarItems<T extends { isPinned?: boolean }>(
  items: readonly T[],
  order: SidebarOrder,
  name: (item: T) => string,
  compareRecent?: (left: T, right: T) => number
): T[] {
  return [...items].sort((left, right) => {
    const byPin = Number(Boolean(right.isPinned)) - Number(Boolean(left.isPinned))
    if (byPin) return byPin
    if (order === 'recent') return compareRecent?.(left, right) ?? 0
    const byName = name(left).localeCompare(name(right))
    return order === 'ascending' ? byName : -byName
  })
}

interface SidebarSortMenuProps {
  section: 'chats' | 'workspaces'
  order: SidebarOrder
  onChange: (order: SidebarOrder) => void
}

export function SidebarSortMenu({ section, order, onChange }: SidebarSortMenuProps) {
  const labels = {
    recent: section === 'workspaces' ? 'Recently visited' : 'Recent activity',
    ascending: 'Name (A–Z)',
    descending: 'Name (Z–A)',
  }
  return (
    <ActionMenu
      label={`Sort ${section}`}
      triggerSize='compact'
      icon='I050'
      actions={ORDERS.map((value) => ({
        id: value,
        label: labels[value],
        checked: value === order,
        onSelect: () => onChange(value),
      }))}
    />
  )
}
