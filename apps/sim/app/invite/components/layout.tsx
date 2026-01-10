'use client'

import AuthBackground from '@/app/(auth)/components/auth-background'
import Nav from '@/app/(landing)/components/nav/nav'

interface InviteLayoutProps {
  children: React.ReactNode
}

export default function InviteLayout({ children }: InviteLayoutProps) {
  return (
    <AuthBackground>
      <main className='relative flex min-h-screen flex-col text-foreground'>
        <Nav hideAuthButtons={true} variant='auth' />
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='w-full max-w-lg px-4'>
            <div className='flex flex-col items-center justify-center'>{children}</div>
          </div>
        </div>
      </main>
    </AuthBackground>
  )
}
