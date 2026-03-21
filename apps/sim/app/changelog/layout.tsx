import { getNavBlogPosts } from '@/lib/blog/registry'
import { martianMono } from '@/app/_styles/fonts/martian-mono/martian-mono'
import { season } from '@/app/_styles/fonts/season/season'
import Footer from '@/app/(home)/components/footer/footer'
import Navbar from '@/app/(home)/components/navbar/navbar'
import '@/app/(landing)/blog/studio-scrollbar.css'

export default async function ChangelogLayout({ children }: { children: React.ReactNode }) {
  const blogPosts = await getNavBlogPosts()
  return (
    <div
      className={`${season.variable} ${martianMono.variable} studio-scroll flex min-h-screen flex-col bg-[#1C1C1C] font-[430] font-season text-[#ECECEC]`}
    >
      <header className='sticky top-0 z-50'>
        <Navbar blogPosts={blogPosts} />
      </header>
      <div className='flex flex-1 flex-col'>{children}</div>
      <div className='border-t border-[#2A2A2A]'>
        <Footer hideCTA />
      </div>
    </div>
  )
}
