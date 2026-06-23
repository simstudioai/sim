'use client'

import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import { ChipLink } from '@/components/emcn'
import { GithubOutlineIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'

/**
 * Mobile navigation — the `< lg` counterpart to the desktop nav clusters.
 *
 * Renders an always-visible "Sign up" chip plus a hamburger that toggles a
 * full-width slide-down sheet anchored under the bar (`top-full`). The sheet
 * carries the primary links and auth CTAs stacked, on the platform's `--bg`
 * surface with a `--border` hairline. Only this leaf hydrates; the desktop nav
 * stays server-rendered.
 *
 * The sheet locks body scroll while open and closes on route change intent
 * (any link tap) and on `Escape`. Motion is a short token-driven
 * transform/opacity that collapses under `prefers-reduced-motion`.
 */

interface MobileNavProps {
  /** Formatted GitHub star count (e.g. "28.8k"). */
  stars: string
}

const PRIMARY_LINKS = [
  { label: 'Platform', href: '/' },
  { label: 'Resources', href: '/blog' },
  { label: 'Solutions', href: '/contact' },
  { label: 'Pricing', href: '/pricing' },
] as const

export function MobileNav({ stars }: MobileNavProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className='ml-auto flex items-center gap-2 lg:hidden'>
      <ChipLink variant='primary' href='/signup'>
        Sign up
      </ChipLink>
      <button
        type='button'
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className='flex size-[30px] items-center justify-center rounded-lg border border-[var(--border-1)] text-[var(--text-icon)] transition-colors hover:bg-[var(--surface-hover)]'
      >
        {open ? <X className='size-[18px]' /> : <Menu className='size-[18px]' />}
      </button>

      {open ? (
        <button
          type='button'
          aria-hidden='true'
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className='fixed inset-0 top-full z-40 cursor-default bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]'
        />
      ) : null}

      <div
        className={cn(
          'absolute top-full right-0 left-0 z-50 origin-top border-[var(--border)] border-b bg-[var(--bg)] transition-[opacity,transform] duration-200 motion-reduce:transition-none',
          open
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : '-translate-y-2 pointer-events-none opacity-0'
        )}
      >
        <div className='mx-auto flex w-full max-w-[1446px] flex-col gap-1 px-5 pt-2 pb-5'>
          {PRIMARY_LINKS.map(({ label, href }) => (
            <Link
              key={label}
              href={href}
              onClick={() => setOpen(false)}
              className='rounded-lg px-3 py-2.5 text-[15px] text-[var(--text-body)] transition-colors hover:bg-[var(--surface-hover)]'
            >
              {label}
            </Link>
          ))}

          <a
            href='https://github.com/simstudioai/sim'
            target='_blank'
            rel='noopener noreferrer'
            onClick={() => setOpen(false)}
            className='flex items-center gap-2 rounded-lg px-3 py-2.5 text-[15px] text-[var(--text-body)] transition-colors hover:bg-[var(--surface-hover)]'
          >
            <GithubOutlineIcon className='size-[16px] text-[var(--text-icon)]' />
            <span>GitHub</span>
            <span className='text-[var(--text-muted)]'>{stars}</span>
          </a>

          <div className='mt-3 flex flex-col gap-2'>
            <ChipLink
              href='/login'
              fullWidth
              flush
              className='h-[40px] justify-center border border-[var(--border-1)] [&>span]:flex-none'
              onClick={() => setOpen(false)}
            >
              Log in
            </ChipLink>
            <ChipLink
              variant='primary'
              href='/contact'
              fullWidth
              flush
              className='h-[40px] justify-center [&>span]:flex-none'
              onClick={() => setOpen(false)}
            >
              Contact sales
            </ChipLink>
          </div>
        </div>
      </div>
    </div>
  )
}
