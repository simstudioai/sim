import type { ReactNode } from 'react'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { SupportFooter } from '@/app/(auth)/components/support-footer'
import { Navbar } from '@/app/(landing)/components/navbar/navbar'

interface PublicFileAuthShellProps {
  title: string
  subtitle: string
  children: ReactNode
}

/**
 * Landing-chrome shell shared by the public file-share auth gates (password,
 * email OTP, SSO), matching the deployed-chat auth screens. Renders no file
 * metadata — the name/provenance are withheld until the visitor authenticates.
 */
export function PublicFileAuthShell({ title, subtitle, children }: PublicFileAuthShellProps) {
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
                <h1 className='text-balance font-[430] font-season text-[40px] text-[var(--landing-text)] leading-[110%] tracking-[-0.02em]'>
                  {title}
                </h1>
                <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
                  {subtitle}
                </p>
              </div>
              <div className='mt-8 w-full max-w-[410px]'>{children}</div>
            </div>
          </div>
        </div>
        <SupportFooter position='absolute' />
      </main>
    </AuthBackground>
  )
}
