'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useBrandConfig } from '@/lib/branding/branding'
import Nav from '@/app/(landing)/components/nav/nav'
import { inter } from '@/app/fonts/inter/inter'
import { soehne } from '@/app/fonts/soehne/soehne'

export default function NotFound() {
  const [buttonClass, setButtonClass] = useState('auth-button-gradient')
  const brandConfig = useBrandConfig()
  const router = useRouter()

  useEffect(() => {
    const root = document.documentElement
    const hadDark = root.classList.contains('dark')
    const hadLight = root.classList.contains('light')
    root.classList.add('light')
    root.classList.remove('dark')
    return () => {
      if (!hadLight) root.classList.remove('light')
      if (hadDark) root.classList.add('dark')
    }
  }, [])

  useEffect(() => {
    const checkCustomBrand = () => {
      const computedStyle = getComputedStyle(document.documentElement)
      const brandAccent = computedStyle.getPropertyValue('--brand-accent-hex').trim()
      if (brandAccent && brandAccent !== '#6f3dfa') {
        setButtonClass('auth-button-custom')
      } else {
        setButtonClass('auth-button-gradient')
      }
    }
    checkCustomBrand()
    window.addEventListener('resize', checkCustomBrand)
    const observer = new MutationObserver(checkCustomBrand)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
    return () => {
      window.removeEventListener('resize', checkCustomBrand)
      observer.disconnect()
    }
  }, [])

  return (
    <div className='min-h-screen bg-white'>
      <Nav variant='auth' />
      <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
        <div className='w-full max-w-[410px]'>
          <div className='flex flex-col items-center justify-center'>
            <div className='space-y-1 text-center'>
              <h1
                className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}
              >
                Page Not Found
              </h1>
              <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                The page you’re looking for doesn’t exist or has been moved.
              </p>
            </div>

            <div className='mt-8 w-full space-y-3'>
              <Button
                type='button'
                onClick={() => router.push('/')}
                className={`${buttonClass} flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200`}
              >
                Return to Home
              </Button>
            </div>

            <div
              className={`${inter.className} auth-text-muted fixed right-0 bottom-0 left-0 z-50 pb-8 text-center font-[340] text-[13px] leading-relaxed`}
            >
              Need help?{' '}
              <a
                href={`mailto:${brandConfig.supportEmail}`}
                className='auth-link underline-offset-4 transition hover:underline'
              >
                Contact support
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
