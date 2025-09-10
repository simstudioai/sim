'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GithubIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console/logger'
import { soehne } from '@/app/fonts/soehne/soehne'

const logger = createLogger('nav')

export default function Nav() {
  const [githubStars, setGithubStars] = useState('14.7k')
  const [isHovered, setIsHovered] = useState(false)
  const [isLoginHovered, setIsLoginHovered] = useState(false)
  const router = useRouter()

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

  const handleLoginClick = (e: React.MouseEvent) => {
    e.preventDefault()
    router.push('/login')
  }

  const NavLinks = () => (
    <>
      <li>
        <Link
          href='https://docs.sim.ai'
          target='_blank'
          rel='noopener noreferrer'
          className='text-[16px] text-muted-foreground transition-colors hover:text-foreground'
        >
          Docs
        </Link>
      </li>
      <li>
        <Link
          href='#pricing'
          className='text-[16px] text-muted-foreground transition-colors hover:text-foreground'
        >
          Pricing
        </Link>
      </li>
      <li>
        <button
          onClick={() => window.open('https://form.typeform.com/to/jqCO12pF', '_blank')}
          className='text-[16px] text-muted-foreground transition-colors hover:text-foreground'
        >
          Enterprise
        </button>
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
        <div className='flex items-center justify-center gap-[16px] pt-[1.5px]'>
          <button
            onClick={handleLoginClick}
            onMouseEnter={() => setIsLoginHovered(true)}
            onMouseLeave={() => setIsLoginHovered(false)}
            className='group hidden text-[#2E2E2E] text-[16px] transition-colors hover:text-foreground md:block'
          >
            <span className='flex items-center gap-1'>
              Log in
              <span className='inline-flex transition-transform duration-200 group-hover:translate-x-0.5'>
                {isLoginHovered ? (
                  <ArrowRight className='h-4 w-4' />
                ) : (
                  <ChevronRight className='h-4 w-4' />
                )}
              </span>
            </span>
          </button>
          <Link
            href='/signup'
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className='group inline-flex items-center justify-center gap-2 rounded-[10px] border border-[#6F3DFA] bg-gradient-to-b from-[#8357FF] to-[#6F3DFA] py-[6px] pr-[10px] pl-[12px] text-[14px] text-white shadow-[inset_0_2px_4px_0_#9B77FF] transition-all sm:text-[16px]'
            aria-label='Get started with Sim'
          >
            <span className='flex items-center gap-1'>
              Get started
              <span className='inline-flex transition-transform duration-200 group-hover:translate-x-0.5'>
                {isHovered ? (
                  <ArrowRight className='h-4 w-4' />
                ) : (
                  <ChevronRight className='h-4 w-4' />
                )}
              </span>
            </span>
          </Link>
        </div>
      </nav>
    </>
  )
}
