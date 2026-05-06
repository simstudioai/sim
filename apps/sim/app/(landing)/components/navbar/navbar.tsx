'use client'

import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import Link from 'next/link'
import { GithubOutlineIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import { SessionContext } from '@/app/_shell/providers/session-provider'
import {
  BlogDropdown,
  type NavBlogPost,
} from '@/app/(landing)/components/navbar/components/blog-dropdown'
import { DocsDropdown } from '@/app/(landing)/components/navbar/components/docs-dropdown'
import { GitHubStars } from '@/app/(landing)/components/navbar/components/github-stars'
import { trackLandingCta } from '@/app/(landing)/landing-analytics'
import { getBrandConfig } from '@/ee/whitelabeling'

const AuthModal = dynamic(
  () => import('@/app/(landing)/components/auth-modal/auth-modal').then((m) => m.AuthModal),
  { loading: () => null }
)

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
  { label: 'Integrations', href: '/integrations' },
  { label: 'Models', href: '/models' },
  { label: 'Pricing', href: '/#pricing' },
]

const LOGO_CELL = 'flex items-center pl-5 lg:pl-16 pr-5'
const LINK_CELL = 'flex items-center px-3.5'

const emptySubscribe = () => () => {}

interface NavbarProps {
  logoOnly?: boolean
  blogPosts?: NavBlogPost[]
}

export default function Navbar({ logoOnly = false, blogPosts = [] }: NavbarProps) {
  const brand = getBrandConfig()
  const sessionCtx = useContext(SessionContext)
  const session = sessionCtx?.data ?? null
  const isSessionPending = sessionCtx?.isPending ?? true
  const isAuthenticated = Boolean(session?.user?.id)
  const [isBrowsingHome, setIsBrowsingHome] = useState(false)
  useEffect(() => {
    setIsBrowsingHome(new URLSearchParams(window.location.search).has('home'))
  }, [])
  const useHomeLinks = isAuthenticated || isBrowsingHome
  const logoHref = useHomeLinks ? '/?home' : '/'
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )
  const shouldShow = mounted && !isSessionPending
  const [activeDropdown, setActiveDropdown] = useState<DropdownId>(null)
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

  return (
    <nav
      aria-label='Primary navigation'
      className='relative flex h-[58px] border-[var(--landing-bg-elevated)] border-b-[1px] bg-[var(--landing-bg)] font-[430] font-season text-[var(--landing-text)] text-sm'
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
            alt=''
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
              const linkClass = cn(
                icon ? `${LINK_CELL} gap-2` : LINK_CELL,
                'h-[30px] self-center rounded-[5px] transition-colors duration-200 group-hover:bg-[var(--landing-bg-elevated)]'
              )
              const chevron = icon === 'chevron' && <NavChevron open={isActive} />

              if (hasDropdown) {
                return (
                  <li
                    key={label}
                    className='group relative flex'
                    onMouseEnter={() => openDropdown(dropdown)}
                    onMouseLeave={scheduleClose}
                  >
                    {external ? (
                      <a
                        href={href}
                        target='_blank'
                        rel='noopener noreferrer'
                        itemProp='url'
                        className={cn(linkClass, 'cursor-pointer')}
                      >
                        {label}
                        {chevron}
                      </a>
                    ) : (
                      <Link href={href} itemProp='url' className={cn(linkClass, 'cursor-pointer')}>
                        {label}
                        {chevron}
                      </Link>
                    )}

                    {isActive && (
                      <div className='-mt-0.5 pointer-events-auto absolute top-full left-0 z-50'>
                        {dropdown === 'docs' && <DocsDropdown />}
                        {dropdown === 'blog' && <BlogDropdown posts={blogPosts} />}
                      </div>
                    )}
                  </li>
                )
              }

              return (
                <li key={label} className='group flex'>
                  {external ? (
                    <a
                      href={href}
                      target='_blank'
                      rel='noopener noreferrer'
                      itemProp='url'
                      className={linkClass}
                    >
                      {label}
                      {chevron}
                    </a>
                  ) : (
                    <Link href={href} itemProp='url' className={linkClass} aria-label={label}>
                      {label}
                      {chevron}
                    </Link>
                  )}
                </li>
              )
            })}
            <li className='group flex'>
              <GitHubStars />
            </li>
          </ul>

          <div className='hidden flex-1 lg:block' />

          <div
            aria-hidden={!shouldShow || undefined}
            inert={!shouldShow || undefined}
            className={cn(
              'hidden items-center gap-2 pr-16 pl-5 transition-opacity duration-200 lg:flex',
              shouldShow ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
          >
            {isAuthenticated ? (
              <Link
                href='/workspace'
                className='inline-flex h-[30px] items-center gap-[7px] rounded-[5px] border border-[var(--white)] bg-[var(--white)] px-[9px] text-[13.5px] text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
                aria-label='Go to app'
                onClick={() =>
                  trackLandingCta({
                    label: 'Go to App',
                    section: 'navbar',
                    destination: '/workspace',
                  })
                }
              >
                Go to App
              </Link>
            ) : (
              <>
                <AuthModal defaultView='login' source='navbar'>
                  <button
                    type='button'
                    className='inline-flex h-[30px] items-center rounded-[5px] border border-[var(--landing-border-strong)] px-[9px] text-[13.5px] text-[var(--landing-text)] transition-colors hover:bg-[var(--landing-bg-elevated)]'
                    aria-label='Log in'
                    onClick={() =>
                      trackLandingCta({
                        label: 'Log in',
                        section: 'navbar',
                        destination: 'auth_modal',
                      })
                    }
                  >
                    Log in
                  </button>
                </AuthModal>
                <AuthModal defaultView='signup' source='navbar'>
                  <button
                    type='button'
                    className='inline-flex h-[30px] items-center gap-[7px] rounded-[5px] border border-[var(--white)] bg-[var(--white)] px-2.5 text-[13.5px] text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]'
                    aria-label='Get started with Sim'
                    onClick={() =>
                      trackLandingCta({
                        label: 'Get started',
                        section: 'navbar',
                        destination: 'auth_modal',
                      })
                    }
                  >
                    Get started
                  </button>
                </AuthModal>
              </>
            )}
          </div>

          <div className='flex flex-1 items-center justify-end pr-5 lg:hidden'>
            <button
              type='button'
              className='flex h-[32px] w-[32px] items-center justify-center rounded-[5px] transition-colors hover:bg-[var(--landing-bg-elevated)]'
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
            >
              <MobileMenuIcon open={mobileMenuOpen} />
            </button>
          </div>

          <div
            className={cn(
              'fixed inset-x-0 top-[58px] bottom-0 z-50 flex flex-col overflow-y-auto bg-[var(--landing-bg)] font-[430] font-season text-sm transition-all duration-200 lg:hidden',
              mobileMenuOpen ? 'visible opacity-100' : 'invisible opacity-0'
            )}
          >
            <ul className='flex flex-col'>
              {NAV_LINKS.map(({ label, href: rawHref, external }) => {
                const href =
                  useHomeLinks && rawHref.startsWith('/#') ? `/?home${rawHref.slice(1)}` : rawHref
                return (
                  <li key={label} className='border-[var(--landing-border)] border-b'>
                    {external ? (
                      <a
                        href={href}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='flex items-center justify-between px-5 py-3.5 text-[var(--landing-text)] transition-colors active:bg-[var(--landing-bg-elevated)]'
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {label}
                        <ExternalArrowIcon />
                      </a>
                    ) : (
                      <Link
                        href={href}
                        className='flex items-center px-5 py-3.5 text-[var(--landing-text)] transition-colors active:bg-[var(--landing-bg-elevated)]'
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {label}
                      </Link>
                    )}
                  </li>
                )
              })}
              <li className='border-[var(--landing-border)] border-b'>
                <a
                  href='https://github.com/simstudioai/sim'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='flex items-center gap-2 px-5 py-3.5 text-[var(--landing-text)] transition-colors active:bg-[var(--landing-bg-elevated)]'
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <GithubOutlineIcon className='h-[14px] w-[14px]' />
                  GitHub
                </a>
              </li>
            </ul>

            <div
              aria-hidden={!shouldShow || undefined}
              inert={!shouldShow || undefined}
              className={cn(
                'mt-auto flex flex-col gap-2.5 p-5 transition-opacity duration-200',
                shouldShow ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              {isAuthenticated ? (
                <Link
                  href='/workspace'
                  className='flex h-[32px] items-center justify-center rounded-[5px] border border-[var(--white)] bg-[var(--white)] text-[14px] text-black transition-colors active:bg-[#E0E0E0]'
                  onClick={() => {
                    trackLandingCta({
                      label: 'Go to App',
                      section: 'navbar',
                      destination: '/workspace',
                    })
                    setMobileMenuOpen(false)
                  }}
                  aria-label='Go to app'
                >
                  Go to App
                </Link>
              ) : (
                <>
                  <AuthModal defaultView='login' source='mobile_navbar'>
                    <button
                      type='button'
                      className='flex h-[32px] items-center justify-center rounded-[5px] border border-[var(--landing-border-strong)] text-[14px] text-[var(--landing-text)] transition-colors active:bg-[var(--landing-bg-elevated)]'
                      onClick={() =>
                        trackLandingCta({
                          label: 'Log in',
                          section: 'navbar',
                          destination: 'auth_modal',
                        })
                      }
                      aria-label='Log in'
                    >
                      Log in
                    </button>
                  </AuthModal>
                  <AuthModal defaultView='signup' source='mobile_navbar'>
                    <button
                      type='button'
                      className='flex h-[32px] items-center justify-center rounded-[5px] border border-[var(--white)] bg-[var(--white)] text-[14px] text-black transition-colors active:bg-[#E0E0E0]'
                      onClick={() =>
                        trackLandingCta({
                          label: 'Get started',
                          section: 'navbar',
                          destination: 'auth_modal',
                        })
                      }
                      aria-label='Get started with Sim'
                    >
                      Get started
                    </button>
                  </AuthModal>
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

/** Matches the exact geometry of the emcn ChevronDown SVG — transform origins are intentional. */
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
    <svg
      width='12'
      height='12'
      viewBox='0 0 12 12'
      fill='none'
      className='text-[var(--landing-text-secondary)]'
    >
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
