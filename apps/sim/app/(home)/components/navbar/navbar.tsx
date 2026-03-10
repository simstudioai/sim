import Image from 'next/image'
import Link from 'next/link'
import { ChevronDown } from '@/components/emcn'
import { GitHubStars } from '@/app/(home)/components/navbar/components/github-stars'

interface NavLink {
  label: string
  href: string
  external?: boolean
  icon?: 'chevron'
}

const NAV_LINKS: NavLink[] = [
  { label: 'Docs', href: '/docs', icon: 'chevron' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Careers', href: '/careers' },
  { label: 'Enterprise', href: '/enterprise' },
]

/** Logo and nav edge: horizontal padding (px) for left/right symmetry. */
const LOGO_CELL = 'flex items-center px-[20px]'

/** Links: even spacing between items. */
const LINK_CELL = 'flex items-center px-[14px]'

export default function Navbar() {
  return (
    <nav
      aria-label='Primary navigation'
      className='flex h-[52px] border-[#2A2A2A] border-b-[1px] bg-[#1C1C1C] font-[430] font-season text-[#ECECEC] text-[14px]'
      itemScope
      itemType='https://schema.org/SiteNavigationElement'
    >
      {/* Logo */}
      <Link href='/' className={LOGO_CELL} aria-label='Sim home' itemProp='url'>
        <span itemProp='name' className='sr-only'>
          Sim
        </span>
        <Image
          src='/logo/sim-landing.svg'
          alt='Sim'
          width={71}
          height={22}
          className='h-[22px] w-auto'
          priority
        />
      </Link>

      {/* Links */}
      <ul className='mt-[0.75px] flex'>
        {NAV_LINKS.map(({ label, href, external, icon }) => (
          <li key={label} className='flex'>
            {external ? (
              <a href={href} target='_blank' rel='noopener noreferrer' className={LINK_CELL}>
                {label}
              </a>
            ) : (
              <Link
                href={href}
                className={icon ? `${LINK_CELL} gap-[8px]` : LINK_CELL}
                aria-label={label}
              >
                {label}
                {icon === 'chevron' && (
                  <ChevronDown className='mt-[1.75px] h-[10px] w-[10px] flex-shrink-0 text-[#ECECEC]' />
                )}
              </Link>
            )}
          </li>
        ))}
        <li className='flex'>
          <GitHubStars />
        </li>
      </ul>

      <div className='flex-1' />

      {/* CTAs */}
      <div className='flex items-center gap-[8px] px-[20px]'>
        <Link
          href='/login'
          className='inline-flex h-[30px] items-center rounded-[5px] border border-[#3d3d3d] px-[9px] text-[#ECECEC] text-[13.5px] transition-colors hover:bg-[#2A2A2A]'
          aria-label='Log in'
        >
          Log in
        </Link>
        <Link
          href='/signup'
          className='inline-flex h-[30px] items-center gap-[7px] rounded-[5px] border border-[#33C482] bg-[#33C482] px-[9px] text-[13.5px] text-black transition-[filter] hover:brightness-110'
          aria-label='Get started with Sim'
        >
          Get started
        </Link>
      </div>
    </nav>
  )
}
