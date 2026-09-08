'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@sim/emcn'
import { Menu, X } from '@sim/emcn/icons'
import Link from 'next/link'
import { GithubOutlineIcon } from '@/components/icons'
import { LandingCtaLink } from '@/app/(landing)/components/landing-cta-link'
import { NAV_MENUS } from '@/app/(landing)/components/navbar/components/nav-menu-chip'
import { NavbarAuthPill } from '@/app/(landing)/components/navbar/components/navbar-auth-pill'
import { NAVBAR_GLASS_SURFACE } from '@/app/(landing)/components/navbar/components/navbar-shell'
import { useNavbarMenu } from '@/app/(landing)/components/navbar/hooks/use-navbar-menu'
import colorMixFallbacks from '@/app/(landing)/components/shared/color-mix-fallbacks/color-mix-fallbacks.module.css'
import { DEMO_HREF } from '@/app/(landing)/constants'

/**
 * Navigation below `xl`. Tablets keep Log in, Start building, and the demo CTA
 * in the bar; phones show only the wordmark and the menu button, since the
 * actions no longer fit beside the wordmark at narrow widths. On phones,
 * the sheet carries the actions above the product links. It closes on navigation or Escape.
 * The navbar shell locks the page scroll and coordinates its frosted surface.
 */

interface MobileNavProps {
  /** Formatted GitHub star count (e.g. "28.8k"). */
  stars: string
}

/**
 * Standalone top-level routes shown in the sheet alongside the expanded mega-menu
 * sections. Pricing is a standalone link on the desktop nav (not a mega-menu), so
 * it stays a single row here too. Every menu in {@link NAV_MENUS} expands here as
 * a grouped section automatically - the sheet mirrors the desktop nav's
 * information architecture with no extra edit.
 */
const STANDALONE_LINKS = [{ label: 'Pricing', href: '/pricing' }] as const

/** Shared row chrome for every tappable text link in the sheet. */
const SHEET_ROW =
  'rounded-lg px-3 py-2.5 text-[15px] text-[var(--text-body)] transition-colors hover:bg-[var(--surface-hover)]'

const MENU_TRANSITION =
  'transition-[opacity,translate,visibility] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none'

export function MobileNav({ stars }: MobileNavProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { open, updateOpen } = useNavbarMenu('mobile')

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      updateOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open, updateOpen])

  return (
    <div className='ml-auto flex items-center gap-2 xl:hidden'>
      <NavbarAuthPill className='max-sm:hidden' onNavigate={() => updateOpen(false)} />
      <LandingCtaLink
        href={DEMO_HREF}
        size='compact'
        withArrow
        className='max-sm:hidden'
        onClick={() => updateOpen(false)}
      >
        Request a demo
      </LandingCtaLink>
      <button
        ref={triggerRef}
        type='button'
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls='mobile-nav-sheet'
        onClick={() => updateOpen(!open)}
        className='flex size-[30px] items-center justify-center rounded-lg border border-[var(--border-1)] text-[var(--text-icon)] transition-colors hover:bg-[var(--surface-hover)]'
      >
        <span aria-hidden='true' className='relative size-[18px]'>
          <Menu
            className={cn(
              'absolute inset-0 size-full transition-[opacity,rotate] duration-150 ease-out motion-reduce:transition-none',
              open ? 'rotate-45 opacity-0' : 'rotate-0 opacity-100'
            )}
          />
          <X
            className={cn(
              'absolute inset-0 size-full transition-[opacity,rotate] duration-150 ease-out motion-reduce:transition-none',
              open ? 'rotate-0 opacity-100' : '-rotate-45 opacity-0'
            )}
          />
        </span>
      </button>

      <button
        type='button'
        aria-hidden='true'
        tabIndex={-1}
        disabled={!open}
        onClick={() => updateOpen(false)}
        className={cn(
          'fixed inset-0 top-[var(--landing-header-height)] z-40 cursor-default',
          MENU_TRANSITION,
          open
            ? 'pointer-events-auto visible opacity-100 duration-[240ms]'
            : 'pointer-events-none invisible opacity-0 duration-[180ms]'
        )}
      >
        <span className={cn('absolute inset-0', colorMixFallbacks.mobileBackdrop)} />
      </button>

      <div
        id='mobile-nav-sheet'
        aria-hidden={!open}
        inert={!open}
        className={cn(
          'absolute top-full right-0 left-0 z-50 max-h-[calc(100dvh-var(--landing-header-height))] origin-top overflow-y-auto overscroll-contain border-[var(--border)] border-b motion-reduce:translate-y-0',
          NAVBAR_GLASS_SURFACE,
          MENU_TRANSITION,
          open
            ? 'pointer-events-auto visible translate-y-0 opacity-100 duration-[240ms]'
            : '-translate-y-2 pointer-events-none invisible opacity-0 duration-[180ms]'
        )}
      >
        <div className='mx-auto flex w-full max-w-[1728px] flex-col gap-1 px-7 pt-2 pb-5'>
          <div className='flex flex-col gap-2 pb-4 sm:hidden'>
            <NavbarAuthPill size='default' onNavigate={() => updateOpen(false)} />
            <LandingCtaLink
              href={DEMO_HREF}
              prefetch={open ? null : false}
              withArrow
              onClick={() => updateOpen(false)}
            >
              Request a demo
            </LandingCtaLink>
          </div>

          {NAV_MENUS.map((menu) => (
            <div key={menu.label} className='flex flex-col'>
              <span className='px-3 pt-2.5 pb-1 text-[13px] text-[var(--text-muted)]'>
                {menu.label}
              </span>
              {menu.index && (
                <Link
                  href={menu.index.href}
                  prefetch={open ? null : false}
                  onClick={() => updateOpen(false)}
                  className={SHEET_ROW}
                >
                  {menu.index.label}
                </Link>
              )}
              {menu.sections.map((section) => (
                <div key={section.label} className='flex flex-col'>
                  {section.items.map((item) => {
                    const label = item.brand ? `${item.brand} ${item.title}` : item.title

                    return item.external ? (
                      <a
                        key={item.title}
                        href={item.href}
                        target='_blank'
                        rel='noopener noreferrer'
                        onClick={() => updateOpen(false)}
                        className={SHEET_ROW}
                      >
                        {label}
                      </a>
                    ) : (
                      <Link
                        key={item.title}
                        href={item.href}
                        prefetch={open ? null : false}
                        onClick={() => updateOpen(false)}
                        className={SHEET_ROW}
                      >
                        {label}
                      </Link>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}

          {STANDALONE_LINKS.map(({ label, href }) => (
            <Link
              key={label}
              href={href}
              prefetch={open ? null : false}
              onClick={() => updateOpen(false)}
              className={SHEET_ROW}
            >
              {label}
            </Link>
          ))}

          <a
            href='https://github.com/simstudioai/sim'
            target='_blank'
            rel='noopener noreferrer'
            onClick={() => updateOpen(false)}
            className={cn('flex items-center gap-2', SHEET_ROW)}
          >
            <GithubOutlineIcon className='size-[16px] text-[var(--text-icon)]' />
            <span>GitHub</span>
            <span className='text-[var(--text-muted)]'>{stars}</span>
          </a>
        </div>
      </div>
    </div>
  )
}
