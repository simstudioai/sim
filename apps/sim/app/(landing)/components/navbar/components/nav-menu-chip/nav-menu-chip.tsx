'use client'

import { useEffect, useRef, useState } from 'react'
import { ChipChevronDown, chipContentLabelClass, chipVariants, cn } from '@sim/emcn'
import Link from 'next/link'
import { flushSync } from 'react-dom'
import { ChevronArrow } from '@/app/(landing)/components/chevron-arrow'
import {
  HOME_INSET,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
} from '@/app/(landing)/components/landing-layout'
import { NavMenuCard } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-card'
import { NavMenuItem } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-item'
import { NavMenuLogoMarquee } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-logo-marquee'
import { NavMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/nav-menu-preview'
import type { NavMenu } from '@/app/(landing)/components/navbar/components/nav-menu-chip/types'
import { NAVBAR_GLASS_SURFACE } from '@/app/(landing)/components/navbar/components/navbar-shell'
import { useNavbarMenu } from '@/app/(landing)/components/navbar/hooks/use-navbar-menu'

interface NavMenuClusterProps {
  /** Non-empty group of mega-menus that share one stable panel. */
  menus: readonly [NavMenu, ...NavMenu[]]
}

const PANEL_BASE =
  'pointer-events-none invisible fixed top-[var(--landing-header-height)] right-0 left-0 z-50 translate-y-0.5 opacity-0 transition-[opacity,transform,visibility] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:translate-y-0 motion-reduce:transition-none'
/** Make links focusable immediately on entry; visibility transitions only during exit. */
const PANEL_OPEN =
  'pointer-events-auto visible translate-y-0 opacity-100 transition-[opacity,transform]'
const MENU_ID = 'primary-navigation-mega-menu'

/** Balances the hidden 16px chevron, 2px gap, and asymmetric pill padding at rest. */
const RESTING_LABEL_POSITION = 'translate-x-[7px]'
const TRIGGER_CONTENT_TRANSITION =
  'transition-[opacity,transform,translate] duration-150 ease-out motion-reduce:transition-none'

/**
 * A floating menu hangs from its own trigger, centred under it. The 12px top
 * padding is the hover bridge from the chip's bottom edge to the surface,
 * which lands level with the full-width surface's top.
 */
const FLOATING_BASE =
  'pointer-events-none invisible absolute top-full left-1/2 z-50 -translate-x-1/2 translate-y-0.5 pt-3 opacity-0 transition-[opacity,transform,visibility] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:translate-y-0 motion-reduce:transition-none'
const FLOATING_OPEN =
  'pointer-events-auto visible translate-y-0 opacity-100 transition-[opacity,transform]'

const isFloating = (menu: NavMenu) => menu.layout === 'floating'
const triggerIdFor = (menu: NavMenu) => `nav-${menu.label.toLowerCase()}-menu-trigger`
const floatingPanelIdFor = (menu: NavMenu) => `nav-${menu.label.toLowerCase()}-menu`

/**
 * Desktop mega-menu cluster with one continuous hover and focus boundary.
 * The triggers, the full-width panel, and any floating panel are descendants
 * of the same root. Its padded hit area spans the navbar’s bottom gutter and
 * overlaps the panel’s short entrance motion without moving the triggers. An
 * open surface also bridges the header width for diagonal travel to far-side links. Switching
 * triggers updates content inside the already-open surface instead of
 * unmounting one panel and opening another, eliminating the close/open
 * flicker during lateral movement. A `floating` menu opens its own compact
 * panel under its trigger instead of the shared surface, which keeps the
 * last surface menu so it can fade out with its content intact.
 */
export function NavMenuCluster({ menus }: NavMenuClusterProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { open, updateOpen } = useNavbarMenu('desktop')
  const [activeMenu, setActiveMenu] = useState<NavMenu>(menus[0])
  const [surfaceMenu, setSurfaceMenu] = useState<NavMenu>(
    () => menus.find((menu) => !isFloating(menu)) ?? menus[0]
  )
  const [activeItem, setActiveItem] = useState(surfaceMenu.sections[0].items[0])

  useEffect(() => {
    if (!open) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (rootRef.current?.contains(document.activeElement)) {
        document.getElementById(triggerIdFor(activeMenu))?.focus()
      }
      updateOpen(false)
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [activeMenu, open, updateOpen])

  const activateMenu = (menu: NavMenu) => {
    setActiveMenu(menu)
    if (!isFloating(menu)) {
      setSurfaceMenu(menu)
      setActiveItem(menu.sections[0].items[0])
    }
    updateOpen(true)
  }

  const enterMenu = (menu: NavMenu, last = false) => {
    flushSync(() => activateMenu(menu))
    const panel = document.getElementById(isFloating(menu) ? floatingPanelIdFor(menu) : MENU_ID)
    const links = panel?.querySelectorAll<HTMLAnchorElement>('a[href]')
    ;(last ? links?.[links.length - 1] : links?.[0])?.focus()
  }

  const closeFromPointer = () => {
    if (rootRef.current?.contains(document.activeElement)) return
    updateOpen(false)
  }

  const handleSelect = () => {
    updateOpen(false)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  const surfaceOpen = open && !isFloating(activeMenu)

  return (
    <div
      ref={rootRef}
      className='-mb-5 relative pb-5'
      onMouseLeave={closeFromPointer}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) updateOpen(false)
      }}
    >
      {surfaceOpen && (
        <div
          aria-hidden='true'
          data-navigation-hover-bridge
          className='fixed inset-x-0 top-[calc(var(--landing-header-height)-62px)] z-0 h-[66px]'
        />
      )}
      <div className='relative z-10 flex items-center gap-1'>
        {menus.map((menu) => {
          const active = open && menu.label === activeMenu.label
          const floating = isFloating(menu)
          const triggerId = triggerIdFor(menu)
          const panelId = floating ? floatingPanelIdFor(menu) : MENU_ID

          return (
            <div key={menu.label} className='relative'>
              <button
                id={triggerId}
                type='button'
                aria-label={`${menu.label} menu`}
                aria-controls={panelId}
                aria-haspopup='true'
                aria-expanded={active}
                onMouseEnter={() => activateMenu(menu)}
                onFocus={() => activateMenu(menu)}
                onClick={() => enterMenu(menu)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'ArrowDown' ||
                    event.key === 'ArrowUp' ||
                    (event.key === 'Tab' && !event.shiftKey && active && !floating)
                  ) {
                    event.preventDefault()
                    enterMenu(menu, event.key === 'ArrowUp')
                  }
                }}
                className={cn(
                  chipVariants({ active }),
                  'gap-0.5 rounded-full pr-3 pl-4 transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]'
                )}
              >
                <span
                  className={cn(
                    chipContentLabelClass,
                    TRIGGER_CONTENT_TRANSITION,
                    active ? 'translate-x-0' : RESTING_LABEL_POSITION
                  )}
                >
                  {menu.label}
                </span>
                <ChipChevronDown
                  className={cn(
                    TRIGGER_CONTENT_TRANSITION,
                    active ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0'
                  )}
                />
              </button>

              {floating && (
                <div
                  id={panelId}
                  aria-labelledby={triggerId}
                  aria-hidden={!active}
                  className={cn(FLOATING_BASE, active && FLOATING_OPEN)}
                >
                  <div
                    className={cn(
                      'flex w-[620px] flex-col gap-3 rounded-2xl border border-[var(--border)] p-3 shadow-xs',
                      NAVBAR_GLASS_SURFACE
                    )}
                  >
                    <div
                      role='group'
                      aria-label={menu.sections[0].label}
                      className='grid grid-cols-2 gap-3'
                    >
                      {menu.sections.flatMap((section) =>
                        section.items.map((item) => (
                          <NavMenuCard
                            key={item.title}
                            item={item}
                            prefetch={active ? null : false}
                            onSelect={handleSelect}
                          />
                        ))
                      )}
                    </div>
                    {menu.marquee === 'customers' && <NavMenuLogoMarquee />}
                    {menu.index && (
                      <Link
                        href={menu.index.href}
                        prefetch={active ? null : false}
                        onClick={handleSelect}
                        className='group/link flex items-center justify-between rounded-lg px-2 py-1 text-[var(--text-body)] text-small transition-colors hover:bg-[var(--surface-hover)]'
                      >
                        {menu.index.label}
                        <ChevronArrow />
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div
        id={MENU_ID}
        aria-labelledby={triggerIdFor(surfaceMenu)}
        aria-hidden={!surfaceOpen}
        className={cn(PANEL_BASE, surfaceOpen && PANEL_OPEN)}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]):not([tabindex="-1"])'
            )
          ).filter((control) => !control.closest('[inert], [aria-hidden="true"]'))
          if (event.shiftKey && event.target === controls[0]) {
            event.preventDefault()
            document.getElementById(triggerIdFor(surfaceMenu))?.focus()
          } else if (!event.shiftKey && event.target === controls[controls.length - 1]) {
            const nextMenu = menus[menus.indexOf(surfaceMenu) + 1]
            if (nextMenu) {
              event.preventDefault()
              document.getElementById(triggerIdFor(nextMenu))?.focus()
            }
          }
        }}
      >
        <div className={cn('border-[var(--border)] border-y', NAVBAR_GLASS_SURFACE)}>
          <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
            <div
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_minmax(0,min(48%,640px))] gap-10 py-10 max-xl:gap-9 max-xl:py-9',
                HOME_INSET
              )}
            >
              <div className='grid min-w-0 grid-cols-2 gap-x-10 self-start'>
                {surfaceMenu.sections.map((section) => (
                  <div
                    key={section.label}
                    role='group'
                    aria-label={section.label}
                    className='flex min-w-0 flex-col gap-9'
                  >
                    {section.items.map((item) => (
                      <NavMenuItem
                        key={item.title}
                        item={item}
                        active={surfaceOpen && activeItem.href === item.href}
                        prefetch={surfaceOpen ? null : false}
                        onActivate={() => setActiveItem(item)}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                ))}
              </div>

              <NavMenuPreview item={activeItem} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
