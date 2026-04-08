'use client'

import type { SVGProps } from 'react'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      {...props}
    >
      <circle cx='12' cy='12' r='4' />
      <path d='M12 2v2' />
      <path d='M12 20v2' />
      <path d='m4.93 4.93 1.41 1.41' />
      <path d='m17.66 17.66 1.41 1.41' />
      <path d='M2 12h2' />
      <path d='M20 12h2' />
      <path d='m6.34 17.66-1.41 1.41' />
      <path d='m19.07 4.93-1.41 1.41' />
    </svg>
  )
}

function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      {...props}
    >
      <path d='M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' />
    </svg>
  )
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <button className='flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-full text-foreground/40'>
        <MoonIcon />
      </button>
    )
  }

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className='flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-full text-foreground/40 transition-colors duration-200 hover:bg-neutral-100 hover:text-foreground/70 dark:hover:bg-neutral-800 dark:hover:text-foreground/70'
      aria-label='Toggle theme'
    >
      {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
    </button>
  )
}
