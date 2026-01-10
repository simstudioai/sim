'use client'

import type { ReactNode } from 'react'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'
import AuthBackground from '@/app/(auth)/components/auth-background'
import Nav from '@/app/(landing)/components/nav/nav'
import { SupportFooter } from './support-footer'

export interface StatusPageLayoutProps {
  /** Page title displayed prominently */
  title: string
  /** Description text below the title */
  description: string | ReactNode
  /** Content to render below the title/description (usually buttons) */
  children?: ReactNode
  /** Whether to show the support footer (default: true) */
  showSupportFooter?: boolean
  /** Whether to hide the nav bar (useful for embedded forms) */
  hideNav?: boolean
}

/**
 * Unified layout for status/error pages (404, form unavailable, chat error, etc.).
 * Uses AuthBackground and Nav for consistent styling with auth pages.
 *
 * @example
 * ```tsx
 * <StatusPageLayout
 *   title="Page Not Found"
 *   description="The page you're looking for doesn't exist."
 * >
 *   <BrandedButton onClick={() => router.push('/')}>Return to Home</BrandedButton>
 * </StatusPageLayout>
 * ```
 */
export function StatusPageLayout({
  title,
  description,
  children,
  showSupportFooter = true,
  hideNav = false,
}: StatusPageLayoutProps) {
  return (
    <AuthBackground>
      <main className='relative flex min-h-screen flex-col text-foreground'>
        {!hideNav && <Nav hideAuthButtons={true} variant='auth' />}
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

              {children && (
                <div className={`${inter.className} mt-8 w-full max-w-[410px] space-y-3`}>
                  {children}
                </div>
              )}
            </div>
          </div>
        </div>
        {showSupportFooter && <SupportFooter position='absolute' />}
      </main>
    </AuthBackground>
  )
}
