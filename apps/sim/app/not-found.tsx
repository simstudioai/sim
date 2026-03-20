import Link from 'next/link'
import { getNavBlogPosts } from '@/lib/blog/registry'
import AuthBackground from '@/app/(auth)/components/auth-background'
import Navbar from '@/app/(home)/components/navbar/navbar'

const CTA_BASE =
  'inline-flex items-center h-[32px] rounded-[5px] border px-[10px] font-[430] font-season text-[14px]'

export default async function NotFound() {
  const blogPosts = await getNavBlogPosts()
  return (
    <AuthBackground className='dark font-[430] font-season'>
      <main className='relative flex min-h-full flex-col text-[#ECECEC]'>
        <header className='shrink-0 bg-[#1C1C1C]'>
          <Navbar blogPosts={blogPosts} />
        </header>
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='flex flex-col items-center gap-[12px]'>
            <h1 className='font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
              Page Not Found
            </h1>
            <p className='font-[430] font-season text-[#F6F6F6]/60 text-[18px] leading-[125%] tracking-[0.02em]'>
              The page you&apos;re looking for doesn&apos;t exist or has been moved.
            </p>
            <div className='mt-[12px] flex items-center gap-[8px]'>
              <Link
                href='/'
                className={`${CTA_BASE} gap-[8px] border-[#FFFFFF] bg-[#FFFFFF] text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]`}
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
