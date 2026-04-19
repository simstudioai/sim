import type { Metadata } from 'next'
import Link from 'next/link'
import { AUTH_PRIMARY_CTA_BASE } from '@/app/(auth)/components/auth-button-classes'

export const metadata: Metadata = {
  title: 'Page Not Found',
  robots: { index: false, follow: true },
}

export default function ModelsNotFound() {
  return (
    <div className='flex min-h-[60vh] items-center justify-center px-4 py-24'>
      <div className='flex flex-col items-center gap-3'>
        <h1 className='text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
          Page not found
        </h1>
        <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className='mt-3 flex items-center gap-2'>
          <Link href='/' className={AUTH_PRIMARY_CTA_BASE}>
            Return to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
