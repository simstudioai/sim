'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { GithubOutlineIcon } from '@/components/icons'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import {
  BlogDropdown,
  type NavBlogPost,
} from '@/app/(home)/components/navbar/components/blog-dropdown'
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
  { label: 'Pricing', href: '/#pricing' },
  { label: 'Enterprise', href: 'https://form.typeform.com/to/jqCO12pF', external: true },
]

const LOGO_CELL = 'flex items-center pl-[20px] lg:pl-[80px] pr-[20px]'
const LINK_CELL = 'flex items-center px-[14px]'

interface NavbarProps {
  logoOnly?: boolean
  blogPosts?: NavBlogPost[]
}

export default function Navbar({ logoOnly = false, blogPosts = [] }: NavbarProps) {
  const brand = getBrandConfig()
  const searchParams = useSearchParams()
  const { data: session, isPending: isSessionPending } = useSession()
  const isAuthenticated = Boolean(session?.user?.id)
  const isBrowsingHome = searchParams.has('home')
  const useHomeLinks = isAuthenticated || isBrowsingHome
  const logoHref = useHomeLinks ? '/?home' : '/'
  const [activeDropdown, setActiveDropdown] = useState<DropdownId>(null)
  const [hoveredLink, setHoveredLink] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
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

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const handler = () => {
      if (mq.matches) setMobileMenuOpen(false)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const anyHighlighted = activeDropdown !== null || hoveredLink !== null

  return (
    <nav
      aria-label='Primary navigation'
      className='relative flex h-[52px] border-[#2A2A2A] border-b-[1px] bg-[#1C1C1C] font-[430] font-season text-[#ECECEC] text-[14px]'
      itemScope
      itemType='https://schema.org/SiteNavigationElement'
    >
      <Link href={logoHref} className={LOGO_CELL} aria-label={`${brand.name} home`} itemProp='url'>
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
          <ul className='mt-[0.75px] hidden lg:flex'>
            {NAV_LINKS.map(({ label, href: rawHref, external, icon, dropdown }) => {
              const href =
                useHomeLinks && rawHref.startsWith('/#') ? `/?home${rawHref.slice(1)}` : rawHref
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
                      {dropdown === 'blog' && <BlogDropdown posts={blogPosts} />}
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

          <div className='hidden flex-1 lg:block' />

          <div
            className={cn(
              'hidden items-center gap-[8px] pr-[80px] pl-[20px] lg:flex',
              isSessionPending && 'invisible'
            )}
          >
            {isAuthenticated ? (
              <Link
                href='/workspace'
                className='inline-flex h-[30px] items-center gap-[7px] rounded-[5px] border border-[#FFFFFF] bg-[#FFFFFF] px-[9px] text-[13.5px] text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
                aria-label='Go to app'
              >
                Go to App
              </Link>
            ) : (
              <>
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
              </>
            )}
          </div>

          <div className='flex flex-1 items-center justify-end pr-[20px] lg:hidden'>
            <button
              type='button'
              className='flex h-[32px] w-[32px] items-center justify-center rounded-[5px] transition-colors hover:bg-[#2A2A2A]'
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
            >
              <MobileMenuIcon open={mobileMenuOpen} />
            </button>
          </div>

          <div
            className={cn(
              'fixed inset-x-0 top-[52px] bottom-0 z-50 flex flex-col overflow-y-auto bg-[#1C1C1C] font-[430] font-season text-[14px] transition-all duration-200 lg:hidden',
              mobileMenuOpen ? 'visible opacity-100' : 'invisible opacity-0'
            )}
          >
            <ul className='flex flex-col'>
              {NAV_LINKS.map(({ label, href: rawHref, external }) => {
                const href =
                  useHomeLinks && rawHref.startsWith('/#') ? `/?home${rawHref.slice(1)}` : rawHref
                return (
                  <li key={label} className='border-[#2A2A2A] border-b'>
                    {external ? (
                      <a
                        href={href}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='flex items-center justify-between px-[20px] py-[14px] text-[#ECECEC] transition-colors active:bg-[#2A2A2A]'
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {label}
                        <ExternalArrowIcon />
                      </a>
                    ) : (
                      <Link
                        href={href}
                        className='flex items-center px-[20px] py-[14px] text-[#ECECEC] transition-colors active:bg-[#2A2A2A]'
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {label}
                      </Link>
                    )}
                  </li>
                )
              })}
              <li className='border-[#2A2A2A] border-b'>
                <a
                  href='https://github.com/simstudioai/sim'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='flex items-center gap-[8px] px-[20px] py-[14px] text-[#ECECEC] transition-colors active:bg-[#2A2A2A]'
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <GithubOutlineIcon className='h-[14px] w-[14px]' />
                  GitHub
                </a>
              </li>
            </ul>

            <div
              className={cn(
                'mt-auto flex flex-col gap-[10px] p-[20px]',
                isSessionPending && 'invisible'
              )}
            >
              {isAuthenticated ? (
                <Link
                  href='/workspace'
                  className='flex h-[32px] items-center justify-center rounded-[5px] border border-[#FFFFFF] bg-[#FFFFFF] text-[14px] text-black transition-colors active:bg-[#E0E0E0]'
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label='Go to app'
                >
                  Go to App
                </Link>
              ) : (
                <>
                  <Link
                    href='/login'
                    className='flex h-[32px] items-center justify-center rounded-[5px] border border-[#3d3d3d] text-[#ECECEC] text-[14px] transition-colors active:bg-[#2A2A2A]'
                    onClick={() => setMobileMenuOpen(false)}
                    aria-label='Log in'
                  >
                    Log in
                  </Link>
                  <Link
                    href='/signup'
                    className='flex h-[32px] items-center justify-center rounded-[5px] border border-[#FFFFFF] bg-[#FFFFFF] text-[14px] text-black transition-colors active:bg-[#E0E0E0]'
                    onClick={() => setMobileMenuOpen(false)}
                    aria-label='Get started with Sim'
                  >
                    Get started
                  </Link>
                </>
              )}
            </div>
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

function MobileMenuIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
        <path
          d='M1 1L13 13M13 1L1 13'
          stroke='currentColor'
          strokeWidth='1.5'
          strokeLinecap='round'
        />
      </svg>
    )
  }
  return (
    <svg width='16' height='12' viewBox='0 0 16 12' fill='none'>
      <path
        d='M0 1H16M0 6H16M0 11H16'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
      />
    </svg>
  )
}

function ExternalArrowIcon() {
  return (
    <svg width='12' height='12' viewBox='0 0 12 12' fill='none' className='text-[#666]'>
      <path
        d='M3.5 2.5H9.5V8.5M9 3L3 9'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
