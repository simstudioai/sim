import type React from 'react'
import { getNavBlogPosts } from '@/lib/blog/registry'
import Footer from '@/app/(landing)/components/footer/footer'
import Navbar from '@/app/(landing)/components/navbar/navbar'

export default async function AcademyCatalogLayout({ children }: { children: React.ReactNode }) {
  const blogPosts = await getNavBlogPosts()

  return (
    <>
      <Navbar blogPosts={blogPosts} />
      {children}
      <Footer hideCTA />
    </>
  )
}
