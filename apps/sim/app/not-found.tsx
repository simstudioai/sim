'use client'

import { useRouter } from 'next/navigation'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
import Navbar from '@/app/(home)/components/navbar/navbar'

export default function NotFound() {
  const router = useRouter()

  return (
    <AuthBackground className='dark font-[430] font-season'>
      <main className='relative flex min-h-full flex-col text-[#ECECEC]'>
        <header className='shrink-0 bg-[#1C1C1C]'>
          <Navbar />
        </header>
        <div className='relative z-30 flex flex-1 flex-col items-center justify-center px-4 pb-24'>
          <h1 className='font-[500] text-[48px] tracking-tight'>Page Not Found</h1>
          <p className='mt-2 text-[#999] text-[16px]'>
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
          <div className='mt-8 w-full max-w-[200px]'>
            <BrandedButton onClick={() => router.push('/')} showArrow={false}>
              Return to Home
            </BrandedButton>
          </div>
        </div>
      </main>
    </AuthBackground>
  )
}
