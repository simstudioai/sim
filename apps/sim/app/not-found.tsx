import type { Metadata } from 'next'
import Link from 'next/link'
import { LogoShell } from '@/app/(landing)/components'

export const metadata: Metadata = {
  title: 'Page Not Found',
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <LogoShell center>
      <div className='flex w-full max-w-[410px] flex-col items-center gap-3 text-center'>
        <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
          Page not found
        </h1>
        <p className='text-[var(--text-muted)] text-lg'>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href='/'
          className='mt-3 inline-flex h-[40px] items-center rounded-[5px] bg-[var(--surface-inverted)] px-5 text-sm text-white transition-colors hover:bg-[var(--surface-inverted-hover)]'
        >
          Return home
        </Link>
      </div>
    </LogoShell>
  )
}
