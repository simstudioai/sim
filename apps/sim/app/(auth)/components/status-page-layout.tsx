import type { ReactNode } from 'react'
import AuthBackground from '@/app/(auth)/components/auth-background'
import Navbar from '@/app/(landing)/components/navbar/navbar'
import { SupportFooter } from './support-footer'

export interface StatusPageLayoutProps {
  title: string
  description: string | ReactNode
  children?: ReactNode
  showSupportFooter?: boolean
}

export function StatusPageLayout({
  title,
  description,
  children,
  showSupportFooter = true,
}: StatusPageLayoutProps) {
  return (
    <AuthBackground className='dark font-[430] font-season'>
      <main className='relative flex min-h-full flex-col text-[var(--landing-text)]'>
        <header className='shrink-0 bg-[var(--landing-bg)]'>
          <Navbar logoOnly />
        </header>
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='w-full max-w-lg px-4'>
            <div className='flex flex-col items-center justify-center'>
              <div className='space-y-1 text-center'>
                <h1 className='text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
                  {title}
                </h1>
                <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
                  {description}
                </p>
              </div>
              {children && <div className='mt-8 w-full max-w-[410px] space-y-3'>{children}</div>}
            </div>
          </div>
        </div>
        {showSupportFooter && <SupportFooter position='absolute' />}
      </main>
    </AuthBackground>
  )
}
