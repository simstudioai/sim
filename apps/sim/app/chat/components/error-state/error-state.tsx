'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import Nav from '@/app/(landing)/components/nav/nav'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'

interface ChatErrorStateProps {
  error: string
  starCount: string
}

export function ChatErrorState({ error, starCount }: ChatErrorStateProps) {
  const router = useRouter()
  const [buttonClass, setButtonClass] = useState('auth-button-gradient')

  useEffect(() => {
    // Check if CSS variable has been customized
    const checkCustomBrand = () => {
      const computedStyle = getComputedStyle(document.documentElement)
      const brandAccent = computedStyle.getPropertyValue('--brand-accent-hex').trim()

      // Check if the CSS variable exists and is different from the default
      if (brandAccent && brandAccent !== '#6f3dfa') {
        setButtonClass('auth-button-custom')
      } else {
        setButtonClass('auth-button-gradient')
      }
    }

    checkCustomBrand()

    // Also check on window resize or theme changes
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
    <div className='bg-white'>
      <Nav variant='auth' />
      <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
        <div className='w-full max-w-[410px]'>
          <div className='flex flex-col items-center justify-center'>
            {/* Error content */}
            <div className='space-y-1 text-center'>
              <h1
                className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}
              >
                Chat Unavailable
              </h1>
              <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                {error}
              </p>
            </div>

            {/* Action button - matching login form */}
            <div className='mt-8 w-full'>
              <Button
                type='button'
                onClick={() => router.push('/workspace')}
                className={`${buttonClass} flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200`}
              >
                Return to Workspace
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
