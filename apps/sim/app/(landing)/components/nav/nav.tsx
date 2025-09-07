'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { GithubIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console/logger'
import { soehne } from '@/app/fonts/soehne/soehne'

const logger = createLogger('nav')

export default function Nav() {
  const [githubStars, setGithubStars] = useState('14.5k')

  useEffect(() => {
    const fetchStars = async () => {
      try {
        const response = await fetch('/api/github-stars')
        const data = await response.json()
        setGithubStars(data.stars)
      } catch (error) {
        logger.warn('Error fetching GitHub stars:', error)
      }
    }

    fetchStars()
  }, [])

  const NavLinks = () => (
    <>
      <li>
        <Link
          href='https://docs.sim.ai'
          target='_blank'
          rel='noopener noreferrer'
          className='text-[16px] text-muted-foreground'
        >
          Docs
        </Link>
      </li>
      <li>
        <Link href='#pricing' className='text-[16px] text-muted-foreground'>
          Pricing
        </Link>
      </li>
      <li>
        <Link href='#enterprise' className='text-[16px] text-muted-foreground'>
          Enterprise
        </Link>
      </li>
      <li>
        <a
          href='https://github.com/simstudioai/sim'
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center gap-2 text-[16px] text-muted-foreground'
          aria-label={`GitHub repository - ${githubStars} stars`}
        >
          <GithubIcon className='h-[16px] w-[16px]' aria-hidden='true' />
          <span>{githubStars}</span>
        </a>
      </li>
    </>
  )

  return (
    <>
      <nav
        aria-label='Primary'
        className={`${soehne.className} flex w-full items-center justify-between px-4 pt-[12px] pb-[21px] sm:px-8 sm:pt-[8.5px] md:px-[44px]`}
      >
        <div className='flex items-center gap-[34px]'>
          <Link href='/' aria-label='Sim home'>
            <Image
              src='/logo/b&w/text/b&w.svg'
              alt='Sim - Workflows for LLMs'
              width={49.78314}
              height={24.276}
              priority
            />
          </Link>
          {/* Desktop Navigation Links - same position as original */}
          <ul className='hidden items-center justify-center gap-[20px] pt-[4px] md:flex'>
            <NavLinks />
          </ul>
        </div>

        {/* Auth Buttons - Desktop shows both, Mobile shows only Get started */}
        <div className='flex items-center justify-center gap-[20px] pt-[1.5px]'>
          <Link href='/login' className='hidden text-[#2E2E2E] text-[16px] md:block'>
            Log in
          </Link>
          <Link
            href='/signup'
            className='inline-flex items-center justify-center gap-2 rounded-[10px] border border-[#6F3DFA] bg-gradient-to-b from-[#8357FF] to-[#6F3DFA] px-3 py-[6px] text-[14px] text-white shadow-[inset_0_2px_4px_0_#9B77FF] sm:text-[16px]'
            aria-label='Get started with Sim'
          >
            Get started
          </Link>
        </div>
      </nav>
    </>
  )
}
