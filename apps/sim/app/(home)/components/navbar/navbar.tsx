'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/core/utils/cn'
import { BlogDropdown } from '@/app/(home)/components/navbar/components/blog-dropdown'
import { DocsDropdown } from '@/app/(home)/components/navbar/components/docs-dropdown'
import { GitHubStars } from '@/app/(home)/components/navbar/components/github-stars'
import { getBrandConfig } from '@/ee/whitelabeling'

type DropdownId = 'docs' | 'blog' | null

interface NavLink {
  label: string
  href: string
  external?: boolean
  icon?: 'chevron'
  dropdown?: 'docs' | 'blog'
}

const NAV_LINKS: NavLink[] = [
  { label: 'Docs', href: 'https://docs.sim.ai', external: true, icon: 'chevron', dropdown: 'docs' },
  { label: 'Blog', href: '/blog', icon: 'chevron', dropdown: 'blog' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Enterprise', href: 'https://form.typeform.com/to/jqCO12pF', external: true },
]

const LOGO_CELL = 'flex items-center pl-[80px] pr-[20px]'
const LINK_CELL = 'flex items-center px-[14px]'

interface NavbarProps {
  logoOnly?: boolean
}

export default function Navbar({ logoOnly = false }: NavbarProps) {
  const brand = getBrandConfig()
  const [activeDropdown, setActiveDropdown] = useState<DropdownId>(null)
  const [hoveredLink, setHoveredLink] = useState<string | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openDropdown = useCallback((id: DropdownId) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setActiveDropdown(id)
  }, [])

  const scheduleClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      setActiveDropdown(null)
      closeTimerRef.current = null
    }, 100)
  }, [])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  const anyHighlighted = activeDropdown !== null || hoveredLink !== null

  return (
    <nav
      aria-label='Primary navigation'
      className='relative flex h-[52px] border-[#2A2A2A] border-b-[1px] bg-[#1C1C1C] font-[430] font-season text-[#ECECEC] text-[14px]'
      itemScope
      itemType='https://schema.org/SiteNavigationElement'
    >
      <Link href='/' className={LOGO_CELL} aria-label={`${brand.name} home`} itemProp='url'>
        <span itemProp='name' className='sr-only'>
          {brand.name}
        </span>
        {brand.logoUrl ? (
          <Image
            src={brand.logoUrl}
            alt={`${brand.name} Logo`}
            width={71}
            height={22}
            className='h-[22px] w-auto object-contain'
            priority
            unoptimized
          />
        ) : (
          <Image
            src='/logo/sim-landing.svg'
            alt='Sim'
            width={71}
            height={22}
            className='h-[22px] w-auto'
            priority
          />
        )}
      </Link>

      {!logoOnly && (
        <>
          <ul className='mt-[0.75px] flex'>
            {NAV_LINKS.map(({ label, href, external, icon, dropdown }) => {
              const hasDropdown = !!dropdown
              const isActive = hasDropdown && activeDropdown === dropdown
              const isThisHovered = hoveredLink === label
              const isHighlighted = isActive || isThisHovered
              const isDimmed = anyHighlighted && !isHighlighted
              const linkClass = cn(
                icon ? `${LINK_CELL} gap-[8px]` : LINK_CELL,
                'transition-colors duration-200',
                isDimmed && 'text-[#F6F6F6]/60'
              )
              const chevron = icon === 'chevron' && <NavChevron open={isActive} />

              if (hasDropdown) {
                return (
                  <li
                    key={label}
                    className='relative flex'
                    onMouseEnter={() => openDropdown(dropdown)}
                    onMouseLeave={scheduleClose}
                  >
                    <button
                      type='button'
                      className={cn(linkClass, 'h-full cursor-pointer')}
                      aria-expanded={isActive}
                      aria-haspopup='true'
                    >
                      {label}
                      {chevron}
                    </button>

                    <div
                      className={cn(
                        '-mt-[2px] absolute top-full left-0 z-50',
                        isActive
                          ? 'pointer-events-auto opacity-100'
                          : 'pointer-events-none opacity-0'
                      )}
                      style={{
                        transform: isActive ? 'translateY(0)' : 'translateY(-6px)',
                        transition: 'opacity 200ms ease, transform 200ms ease',
                      }}
                    >
                      {dropdown === 'docs' && <DocsDropdown />}
                      {dropdown === 'blog' && <BlogDropdown />}
                    </div>
                  </li>
                )
              }

              return (
                <li
                  key={label}
                  className='flex'
                  onMouseEnter={() => setHoveredLink(label)}
                  onMouseLeave={() => setHoveredLink(null)}
                >
                  {external ? (
                    <a href={href} target='_blank' rel='noopener noreferrer' className={linkClass}>
                      {label}
                      {chevron}
                    </a>
                  ) : (
                    <Link href={href} className={linkClass} aria-label={label}>
                      {label}
                      {chevron}
                    </Link>
                  )}
                </li>
              )
            })}
            <li
              className={cn(
                'flex transition-opacity duration-200',
                anyHighlighted && hoveredLink !== 'github' && 'opacity-60'
              )}
              onMouseEnter={() => setHoveredLink('github')}
              onMouseLeave={() => setHoveredLink(null)}
            >
              <GitHubStars />
            </li>
          </ul>

          <div className='flex-1' />

          <div className='flex items-center gap-[8px] pr-[80px] pl-[20px]'>
            <Link
              href='/login'
              className='inline-flex h-[30px] items-center rounded-[5px] border border-[#3d3d3d] px-[9px] text-[#ECECEC] text-[13.5px] transition-colors hover:bg-[#2A2A2A]'
              aria-label='Log in'
            >
              Log in
            </Link>
            <Link
              href='/signup'
              className='inline-flex h-[30px] items-center gap-[7px] rounded-[5px] border border-[#FFFFFF] bg-[#FFFFFF] px-[9px] text-[13.5px] text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
              aria-label='Get started with Sim'
            >
              Get started
            </Link>
          </div>
        </>
      )}
    </nav>
  )
}

interface NavChevronProps {
  open: boolean
}

/**
 * Animated chevron matching the exact geometry of the emcn ChevronDown SVG.
 * Each arm rotates around its midpoint so the center vertex travels up/down
 * while the outer endpoints adjust — producing a Stripe-style morph.
 */
function NavChevron({ open }: NavChevronProps) {
  return (
    <svg width='9' height='6' viewBox='0 0 10 6' fill='none' className='mt-[1.5px] flex-shrink-0'>
      <line
        x1='1'
        y1='1'
        x2='5'
        y2='5'
        stroke='currentColor'
        strokeWidth='1.33'
        strokeLinecap='square'
        style={{
          transformOrigin: '3px 3px',
          transform: open ? 'rotate(-90deg)' : 'rotate(0deg)',
          transition: 'transform 250ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
      <line
        x1='5'
        y1='5'
        x2='9'
        y2='1'
        stroke='currentColor'
        strokeWidth='1.33'
        strokeLinecap='square'
        style={{
          transformOrigin: '7px 3px',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 250ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </svg>
  )
}
