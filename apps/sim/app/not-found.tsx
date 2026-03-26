import type { Metadata } from 'next'
import Link from 'next/link'
import { getNavBlogPosts } from '@/lib/blog/registry'
import AuthBackground from '@/app/(auth)/components/auth-background'
import Navbar from '@/app/(home)/components/navbar/navbar'

export const metadata: Metadata = {
  title: 'Page Not Found',
  robots: { index: false, follow: true },
}

const CTA_BASE =
  'inline-flex items-center h-[32px] rounded-[5px] border px-2.5 font-[430] font-season text-sm'

export default async function NotFound() {
  const blogPosts = await getNavBlogPosts()
  return (
    <AuthBackground className='dark font-[430] font-season'>
      <main className='relative flex min-h-full flex-col text-[var(--landing-text)]'>
        <header className='shrink-0 bg-[var(--landing-bg)]'>
          <Navbar blogPosts={blogPosts} />
        </header>
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='flex flex-col items-center gap-3'>
            <h1 className='text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
              Page not found
            </h1>
            <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
              The page you&apos;re looking for doesn&apos;t exist or has been moved.
            </p>
            <div className='mt-3 flex items-center gap-2'>
              <Link
                href='/'
                className={`${CTA_BASE} gap-2 border-white bg-white text-black transition-colors hover:border-[var(--border-1)] hover:bg-[var(--border-1)]`}
              >
                Return to Home
              </Link>
            </div>
          </div>
        </div>
      </main>
    </AuthBackground>
  )
}
