'use client'

import { useEffect } from 'react'
import AuthBackground from '@/app/(auth)/components/auth-background'
import Navbar from '@/app/(home)/components/navbar/navbar'

export default function AuthLayoutClient({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('dark')
    return () => {
      document.documentElement.classList.remove('dark')
    }
  }, [])

  return (
    <AuthBackground className='dark font-[430] font-season'>
      <main className='relative flex min-h-full flex-col text-[#ECECEC]'>
        <header className='shrink-0 bg-[#1C1C1C]'>
          <Navbar logoOnly />
        </header>
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='w-full max-w-lg px-4'>{children}</div>
        </div>
      </main>
    </AuthBackground>
  )
}
