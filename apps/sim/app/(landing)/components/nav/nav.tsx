'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GithubIcon } from '@/components/icons'
import { useBrandConfig } from '@/lib/branding/branding'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getFormattedGitHubStars } from '@/app/(landing)/actions/github'
import { soehne } from '@/app/fonts/soehne/soehne'

const logger = createLogger('nav')

interface NavProps {
  hideAuthButtons?: boolean
  variant?: 'landing' | 'auth' | 'legal'
}

export default function Nav({ hideAuthButtons = false, variant = 'landing' }: NavProps = {}) {
  const [githubStars, setGithubStars] = useState('18k')
  const [isHovered, setIsHovered] = useState(false)
  const [isLoginHovered, setIsLoginHovered] = useState(false)
  const router = useRouter()
  const brand = useBrandConfig()

  useEffect(() => {
    if (variant !== 'landing') return

    const timeoutId = setTimeout(() => {
      const fetchStars = async () => {
        try {
          const stars = await getFormattedGitHubStars()
          setGithubStars(stars)
        } catch (error) {
          logger.warn('Error fetching GitHub stars:', error)
        }
      }
      fetchStars()
    }, 2000)

    return () => clearTimeout(timeoutId)
  }, [variant])

  const handleLoginClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      router.push('/login')
    },
    [router]
  )

  const handleEnterpriseClick = useCallback(() => {
    window.open('https://form.typeform.com/to/jqCO12pF', '_blank', 'noopener,noreferrer')
  }, [])

  const NavLinks = () => (
    <>
      <li>
        <Link
          href='https://docs.sim.ai'
          target='_blank'
          rel='noopener noreferrer'
          className='text-[16px] text-muted-foreground transition-colors hover:text-foreground'
          prefetch={false}
        >
          Docs
        </Link>
      </li>
      <li>
        <Link
          href='/?from=nav#pricing'
          className='text-[16px] text-muted-foreground transition-colors hover:text-foreground'
          scroll={true}
        >
          Pricing
        </Link>
      </li>
      <li>
        <button
          onClick={handleEnterpriseClick}
          className='text-[16px] text-muted-foreground transition-colors hover:text-foreground'
          type='button'
          aria-label='Contact for Enterprise pricing'
        >
          Enterprise
        </button>
      </li>
      <li>
        <Link
          href='/careers'
          className='text-[16px] text-muted-foreground transition-colors hover:text-foreground'
        >
          Careers
        </Link>
      </li>
      <li>
        <a
          href='https://github.com/simstudioai/sim'
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center gap-2 text-[16px] text-muted-foreground transition-colors hover:text-foreground'
          aria-label={`GitHub repository - ${githubStars} stars`}
        >
          <GithubIcon className='h-[16px] w-[16px]' aria-hidden='true' />
          <span aria-live='polite'>{githubStars}</span>
        </a>
      </li>
    </>
  )

  return (
    <nav
      aria-label='Primary navigation'
      className={`${soehne.className} flex w-full items-center justify-between px-4 ${
        variant === 'auth' ? 'pt-[20px] sm:pt-[16.5px]' : 'pt-[12px] sm:pt-[8.5px]'
      } pb-[21px] sm:px-8 md:px-[44px]`}
      itemScope
      itemType='https://schema.org/SiteNavigationElement'
    >
      <div className='flex items-center gap-[34px]'>
        <Link href='/?from=nav' aria-label={`${brand.name} home`} itemProp='url'>
          <span itemProp='name' className='sr-only'>
            {brand.name} Home
          </span>
          {brand.logoUrl ? (
            <Image
              src={brand.logoUrl}
              alt={`${brand.name} Logo`}
              width={49.78314}
              height={24.276}
              className='h-[24.276px] w-auto object-contain'
              priority
              loading='eager'
              quality={100}
            />
          ) : (
            <Image
              src='/logo/b&w/text/b&w.svg'
              alt='Sim - Workflows for LLMs'
              width={49.78314}
              height={24.276}
              priority
              loading='eager'
              quality={100}
            />
          )}
        </Link>
        {/* Desktop Navigation Links - only show on landing and if hosted */}
        {variant === 'landing' && isHosted && (
          <ul className='hidden items-center justify-center gap-[20px] pt-[4px] md:flex'>
            <NavLinks />
          </ul>
        )}
      </div>

      {/* Auth Buttons - show only when hosted, regardless of variant */}
      {!hideAuthButtons && isHosted && (
        <div className='flex items-center justify-center gap-[16px] pt-[1.5px]'>
          <button
            onClick={handleLoginClick}
            onMouseEnter={() => setIsLoginHovered(true)}
            onMouseLeave={() => setIsLoginHovered(false)}
            className='group hidden text-[#2E2E2E] text-[16px] transition-colors hover:text-foreground md:block'
            type='button'
            aria-label='Log in to your account'
          >
            <span className='flex items-center gap-1'>
              Log in
              <span className='inline-flex transition-transform duration-200 group-hover:translate-x-0.5'>
                {isLoginHovered ? (
                  <ArrowRight className='h-4 w-4' aria-hidden='true' />
                ) : (
                  <ChevronRight className='h-4 w-4' aria-hidden='true' />
                )}
              </span>
            </span>
          </button>
          <Link
            href='/signup'
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className='group inline-flex items-center justify-center gap-2 rounded-[10px] border border-[#6F3DFA] bg-gradient-to-b from-[#8357FF] to-[#6F3DFA] py-[6px] pr-[10px] pl-[12px] text-[14px] text-white shadow-[inset_0_2px_4px_0_#9B77FF] transition-all sm:text-[16px]'
            aria-label='Get started with Sim - Sign up for free'
            prefetch={true}
          >
            <span className='flex items-center gap-1'>
              Get started
              <span className='inline-flex transition-transform duration-200 group-hover:translate-x-0.5'>
                {isHovered ? (
                  <ArrowRight className='h-4 w-4' aria-hidden='true' />
                ) : (
                  <ChevronRight className='h-4 w-4' aria-hidden='true' />
                )}
              </span>
            </span>
          </Link>
        </div>
      )}
    </nav>
  )
}
