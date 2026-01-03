'use client'

import Image from 'next/image'
import Link from 'next/link'
import { GithubIcon } from '@/components/icons'
import { useBrandConfig } from '@/lib/branding/branding'
import { inter } from '@/app/_styles/fonts/inter/inter'

interface FormHeaderProps {
  title: string
  description?: string
  logoUrl?: string
  primaryColor?: string
  starCount?: string
}

export function FormHeader({
  title,
  description,
  logoUrl,
  primaryColor,
  starCount = '24.4k',
}: FormHeaderProps) {
  const brand = useBrandConfig()

  return (
    <nav
      aria-label='Form navigation'
      className='flex w-full items-center justify-between bg-white px-4 pt-[12px] pb-[21px] sm:px-8 sm:pt-[8.5px] md:px-[44px] md:pt-[16px]'
    >
      <div className='flex items-center gap-[34px]'>
        <div className='flex items-center gap-3'>
          {logoUrl && (
            <Image
              src={logoUrl}
              alt={`${title} logo`}
              width={24}
              height={24}
              unoptimized
              className='h-6 w-6 rounded-md object-cover'
            />
          )}
          <h2 className={`${inter.className} font-medium text-[18px] text-foreground`}>{title}</h2>
        </div>
      </div>

      {!brand.logoUrl && (
        <div className='flex items-center gap-[16px]'>
          <a
            href='https://github.com/simstudioai/sim'
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center gap-2 text-[16px] text-muted-foreground transition-colors hover:text-foreground'
            aria-label={`GitHub repository - ${starCount} stars`}
          >
            <GithubIcon className='h-[16px] w-[16px]' aria-hidden='true' />
            <span className={`${inter.className}`} aria-live='polite'>
              {starCount}
            </span>
          </a>

          <Link
            href='https://sim.ai'
            target='_blank'
            rel='noopener noreferrer'
            aria-label='Sim home'
          >
            <Image
              src='/logo/b&w/text/small.png'
              alt='Sim - Workflows for LLMs'
              width={29.869884}
              height={14.5656}
              className='h-[14.5656px] w-auto pb-[1px]'
              priority
              loading='eager'
              quality={100}
            />
          </Link>
        </div>
      )}
    </nav>
  )
}
