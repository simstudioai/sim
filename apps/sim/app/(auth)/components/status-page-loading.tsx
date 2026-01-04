'use client'

import { Loader2 } from 'lucide-react'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'
import AuthBackground from '@/app/(auth)/components/auth-background'
import Nav from '@/app/(landing)/components/nav/nav'
import { SupportFooter } from './support-footer'

export interface StatusPageLoadingProps {
  /** Title to show while loading (default: "Loading") */
  title?: string
  /** Description text below the title */
  description?: string
}

/**
 * Loading state component for status pages.
 * Displays a spinner with optional title and description.
 *
 * @example
 * ```tsx
 * <StatusPageLoading description="Loading your workspace..." />
 * ```
 */
export function StatusPageLoading({
  title = 'Loading',
  description = 'Please wait...',
}: StatusPageLoadingProps) {
  return (
    <AuthBackground>
      <main className='relative flex min-h-screen flex-col text-foreground'>
        <Nav hideAuthButtons={true} variant='auth' />
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='w-full max-w-lg px-4'>
            <div className='flex flex-col items-center justify-center'>
              <div className='space-y-1 text-center'>
                <h1
                  className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}
                >
                  {title}
                </h1>
                <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                  {description}
                </p>
              </div>

              <div
                className={`${inter.className} mt-8 flex w-full items-center justify-center py-8`}
              >
                <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
              </div>
            </div>
          </div>
        </div>
        <SupportFooter position='absolute' />
      </main>
    </AuthBackground>
  )
}
