'use client'

import { forwardRef } from 'react'
import { Chip, ChipLink, cn } from '@sim/emcn'
import { SIDEBAR_RAIL_CHIP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'

export interface SidebarNavItemData {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  href?: string
  onClick?: () => void
  /** Extra path prefixes that should also mark this item as active (e.g. sibling tabs). */
  additionalActivePaths?: string[]
}

/**
 * Whether `pathname` matches `item.href` or any of its `additionalActivePaths` at a
 * segment boundary, so `/foo` never lights up for `/foo-bar`.
 */
export function isNavItemActive(item: SidebarNavItemData, pathname: string | null): boolean {
  if (!pathname) return false
  const matches = (p: string) => pathname === p || pathname.startsWith(`${p}/`)
  if (item.href && matches(item.href)) return true
  return item.additionalActivePaths?.some(matches) ?? false
}

interface SidebarNavChipProps extends React.HTMLAttributes<HTMLElement> {
  item: SidebarNavItemData
  active: boolean
}

/**
 * The rail's nav chip, and the only definition of it.
 *
 * A nav item renders this either bare, under its collapsed tooltip, or as the trigger of a
 * hover flyout — so it forwards its ref and passes extra props through. Radix anchors a menu
 * to the element it is handed, and a trigger that swallowed the ref would leave the menu
 * positioned at the page origin.
 *
 * `className` is merged rather than spread over: Radix's `asChild` slot rewrites the prop on
 * the way in, so letting it through the spread would blank the rail geometry.
 */
export const SidebarNavChip = forwardRef<HTMLElement, SidebarNavChipProps>(function SidebarNavChip(
  { item, active, className, ...props },
  ref
) {
  const chipClassName = cn(SIDEBAR_RAIL_CHIP_CLASS, className)

  if (item.href) {
    return (
      <ChipLink
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={item.href}
        data-item-id={item.id}
        leftIcon={item.icon}
        active={active}
        fullWidth
        className={chipClassName}
        onClick={
          item.onClick
            ? (e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey) return
                e.preventDefault()
                item.onClick?.()
              }
            : undefined
        }
        {...props}
        /* Radix's menu trigger is a button primitive; its `type` is meaningless on the
             anchor this renders through, so it never reaches the DOM. */
        type={undefined}
      >
        {item.label}
      </ChipLink>
    )
  }

  if (!item.onClick) return null

  return (
    <Chip
      ref={ref as React.Ref<HTMLButtonElement>}
      data-item-id={item.id}
      leftIcon={item.icon}
      active={active}
      fullWidth
      className={chipClassName}
      {...props}
      onClick={item.onClick}
    >
      {item.label}
    </Chip>
  )
})
