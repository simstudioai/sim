import { getNavBlogPosts } from '@/lib/blog/registry'
import { martianMono } from '@/app/_styles/fonts/martian-mono/martian-mono'
import Footer from '@/app/(home)/components/footer/footer'
import Navbar from '@/app/(home)/components/navbar/navbar'

export default async function ChangelogLayout({ children }: { children: React.ReactNode }) {
  const blogPosts = await getNavBlogPosts()
  return (
    <div
      className={`${martianMono.variable} relative min-h-screen bg-[#1C1C1C] font-[430] font-season text-[#ECECEC]`}
    >
      <header>
        <Navbar blogPosts={blogPosts} />
      </header>
      {children}
      <Footer hideCTA />
    </div>
  )
}
