import { getNavBlogPosts } from '@/lib/blog/registry'
import { isHosted } from '@/lib/core/config/feature-flags'
import Footer from '@/app/(home)/components/footer/footer'
import Navbar from '@/app/(home)/components/navbar/navbar'

interface LegalLayoutProps {
  title: string
  children: React.ReactNode
}

export default async function LegalLayout({ title, children }: LegalLayoutProps) {
  const blogPosts = await getNavBlogPosts()

  return (
    <main className='min-h-screen bg-[var(--landing-bg)] font-[430] font-season text-[var(--landing-text)]'>
      <header>
        <Navbar blogPosts={blogPosts} />
      </header>

      <div className='mx-auto max-w-[800px] px-6 pt-[60px] pb-20 sm:px-12'>
        <h1 className='mb-12 text-balance text-center font-[500] text-4xl text-[var(--landing-text)] md:text-5xl'>
          {title}
        </h1>
        <div className='space-y-8 text-[var(--landing-text-muted)] text-base leading-[1.7] [&_h2]:mt-12 [&_h2]:mb-6 [&_h2]:text-[var(--landing-text)] [&_h3]:mt-8 [&_h3]:mb-4 [&_h3]:text-[var(--landing-text)] [&_li]:text-[var(--landing-text-muted)] [&_strong]:text-[var(--landing-text)]'>
          {children}
        </div>
      </div>

      {isHosted && <Footer hideCTA />}
    </main>
  )
}
