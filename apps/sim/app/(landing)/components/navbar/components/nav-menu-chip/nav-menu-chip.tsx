'use client'

import { useState } from 'react'
import { ChipChevronDown, chipContentLabelClass, chipGeometryClass, cn } from '@sim/emcn'
import { NavMenuItem } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-item'
import type { NavMenu } from '@/app/(landing)/components/navbar/components/nav-menu-chip/types'

/**
 * Navbar mega-menu - a chip trigger and the framed panel it reveals.
 *
 * Open is CSS-first. The trigger and panel share a `group/navmenu` wrapper; the
 * panel sits behind `invisible opacity-0` and is revealed on
 * `group-hover/navmenu` (pointer) and `group-focus-within/navmenu` (keyboard and
 * touch-focus). The reveal classes ship in the initial HTML, so the menu opens
 * with zero JS even before hydration.
 *
 * The one thing CSS can't do is force the panel shut while the pointer still
 * rests on a just-clicked link (the navbar persists across client navigations,
 * so `:hover`/`:focus-within` keep matching on the new page). A single `closed`
 * flag handles that: selecting a row drops the reveal classes (closing the panel
 * regardless of hover/focus) and blurs the link so focus-within clears;
 * `onMouseLeave` and the trigger's `onFocus` re-arm it for the next open.
 *
 * Accessibility: `visibility: hidden` keeps the panel's links out of the tab
 * order while closed, so Tab order is trigger → (panel opens on focus) → links →
 * next nav item. The 8px `pt-2` bridge keeps the trigger and the framed card in
 * one contiguous hover area so the pointer never crosses a dead gap. Motion
 * collapses under `prefers-reduced-motion`.
 *
 * The panel chrome replicates the `ChipModal` framed-card look exactly: an outer
 * `--surface-4` ring (`p-[3px]`, overlay shadow) wrapping an inner `--bg`
 * surface, with the item grid padded inside.
 */

interface NavMenuChipProps {
  /** The menu to render - trigger label and item grid. */
  menu: NavMenu
}

const PANEL_BASE =
  'pointer-events-none invisible absolute top-full left-0 z-50 translate-y-1 pt-2 opacity-0 transition-[opacity,transform] duration-150 motion-reduce:transition-none'

/** Reveal-on-open classes, omitted while `closed` so a selected menu stays shut. */
const PANEL_REVEAL =
  'group-hover/navmenu:pointer-events-auto group-hover/navmenu:visible group-hover/navmenu:translate-y-0 group-hover/navmenu:opacity-100 group-focus-within/navmenu:pointer-events-auto group-focus-within/navmenu:visible group-focus-within/navmenu:translate-y-0 group-focus-within/navmenu:opacity-100'

export function NavMenuChip({ menu }: NavMenuChipProps) {
  const { label, items } = menu
  const [closed, setClosed] = useState(false)

  const reArm = () => setClosed(false)

  const handleSelect = () => {
    setClosed(true)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  return (
    <div className='group/navmenu relative' onMouseLeave={reArm}>
      <button
        type='button'
        aria-label={`${label} menu`}
        onFocus={reArm}
        className={cn(
          chipGeometryClass,
          'mx-0.5 inline-flex cursor-pointer transition-colors hover-hover:bg-[var(--surface-active)]',
          'group-focus-within/navmenu:bg-[var(--surface-active)] group-hover/navmenu:bg-[var(--surface-active)]'
        )}
      >
        <span className={chipContentLabelClass}>{label}</span>
        <ChipChevronDown />
      </button>

      <div className={cn(PANEL_BASE, !closed && PANEL_REVEAL)}>
        <div className='w-[840px] rounded-xl border border-[var(--border-muted)] bg-[var(--surface-4)] p-[3px] shadow-[var(--shadow-overlay)]'>
          <div className='rounded-lg border border-[var(--border-1)] bg-[var(--bg)] p-2'>
            <div className='grid grid-cols-3 gap-1' role='group' aria-label={label}>
              {items.map((item) => (
                <NavMenuItem key={item.title} item={item} onSelect={handleSelect} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
