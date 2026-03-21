import type { Metadata } from 'next'
import Link from 'next/link'
import { getAllPostMeta } from '@/lib/blog/registry'
import { StudioHero } from '@/app/(landing)/blog/hero'
import { FeaturedGrid, PostGrid } from '@/app/(landing)/blog/post-grid'
import { getCategoryById, getPrimaryCategory } from '@/app/(landing)/blog/tag-colors'

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Announcements, insights, and guides from the Sim team.',
}

export const revalidate = 3600

export default async function BlogIndex({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tag?: string }>
}) {
  const { page, tag } = await searchParams
  const pageNum = Math.max(1, Number(page || 1))
  const perPage = 20

  const all = await getAllPostMeta()
  const filtered = tag ? all.filter((p) => getPrimaryCategory(p.tags).id === tag) : all
  const activeCategory = tag ? getCategoryById(tag) : null

  const sorted = filtered.sort((a, b) => {
    if (a.featured && !b.featured) return -1
    if (!a.featured && b.featured) return 1
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage))
  const start = (pageNum - 1) * perPage
  const pagePosts = sorted.slice(start, start + perPage)

  // Split featured from regular posts on page 1
  const featured = pageNum === 1 && !tag ? pagePosts.filter((p) => p.featured) : []
  const feed = pageNum === 1 && !tag ? pagePosts.filter((p) => !p.featured) : pagePosts

  const studioJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Sim Blog',
    url: 'https://sim.ai/blog',
    description: 'Announcements, insights, and guides for building AI agent workflows.',
  }

  return (
    <div className='flex flex-col'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(studioJsonLd) }}
      />
      {pageNum === 1 && !tag && <StudioHero />}
      <div className='mx-auto w-full max-w-5xl px-4 py-12 lg:px-4'>
        {activeCategory && (
          <div className='mb-8 flex items-center gap-3'>
            <span className='font-mono text-[10px] uppercase tracking-widest text-[#666]'>
              Filtered by:
            </span>
            <span
              className='px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider'
              style={{
                border: `1px solid ${activeCategory.color}`,
                color: activeCategory.color,
              }}
            >
              {activeCategory.label}
            </span>
            <Link
              href='/studio'
              className='font-mono text-[10px] uppercase tracking-wider text-[#999] transition-colors hover:text-[#ECECEC]'
            >
              Clear
            </Link>
          </div>
        )}
        {featured.length > 0 && (
          <section className='mb-10'>
            <h2 className='mb-8 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[#666]'>
              <span className='inline-block h-2 w-2 bg-[#FA4EDF]' aria-hidden='true' />
              Featured Content
            </h2>
            <FeaturedGrid posts={featured} />
          </section>
        )}
        {feed.length > 0 && (
          <section>
            <h2 className='mb-8 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[#666]'>
              <span className='inline-block h-2 w-2 bg-[#00F701]' aria-hidden='true' />
              {activeCategory ? activeCategory.label : 'All Posts'}
            </h2>
            <PostGrid posts={feed} />
          </section>
        )}
        {pagePosts.length === 0 && (
          <div className='py-20 text-center'>
            <p className='font-mono text-[14px] text-[#666]'>No posts found.</p>
            <Link
              href='/studio'
              className='mt-4 inline-block font-mono text-[12px] uppercase tracking-wider text-[#999] transition-colors hover:text-[#ECECEC]'
            >
              View all posts
            </Link>
          </div>
        )}
        {totalPages > 1 && (
          <div className='mt-20 flex items-center justify-center gap-4 border-t border-[#2A2A2A] pt-12'>
            {pageNum > 1 && (
              <Link
                href={`/studio?page=${pageNum - 1}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`}
                className='border border-[#3d3d3d] bg-[#232323] px-6 py-2.5 font-mono text-[11px] uppercase tracking-wider text-[#999] transition-colors hover:border-[#666] hover:text-[#ECECEC]'
                style={{ borderRadius: '5px' }}
              >
                Previous
              </Link>
            )}
            <span className='font-mono text-[10px] uppercase tracking-wider text-[#666]'>
              Page {pageNum} of {totalPages}
            </span>
            {pageNum < totalPages && (
              <Link
                href={`/studio?page=${pageNum + 1}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`}
                className='border border-[#3d3d3d] bg-[#232323] px-6 py-2.5 font-mono text-[11px] uppercase tracking-wider text-[#999] transition-colors hover:border-[#666] hover:text-[#ECECEC]'
                style={{ borderRadius: '5px' }}
              >
                Load more articles
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
