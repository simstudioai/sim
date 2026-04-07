import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/emcn'
import { getAllPostMeta } from '@/lib/blog/registry'

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
  const filtered = tag ? all.filter((p) => p.tags.includes(tag)) : all

  const sorted =
    pageNum === 1
      ? filtered.sort((a, b) => {
          if (a.featured && !b.featured) return -1
          if (!a.featured && b.featured) return 1
          return new Date(b.date).getTime() - new Date(a.date).getTime()
        })
      : filtered

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage))
  const start = (pageNum - 1) * perPage
  const posts = sorted.slice(start, start + perPage)
  const featured = pageNum === 1 ? posts.slice(0, 3) : []
  const remaining = pageNum === 1 ? posts.slice(3) : posts

  const blogJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Sim Blog',
    url: 'https://sim.ai/blog',
    description: 'Announcements, insights, and guides for building AI agent workflows.',
  }

  return (
    <section className='bg-[var(--landing-bg)]'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogJsonLd) }}
      />

      {/* Section header */}
      <div className='px-5 pt-[60px] lg:px-16 lg:pt-[100px]'>
        <Badge
          variant='blue'
          size='md'
          dot
          className='mb-5 bg-white/10 font-season text-white uppercase tracking-[0.02em]'
        >
          Blog
        </Badge>

        <div className='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
          <h1 className='text-balance font-[430] font-season text-[28px] text-white leading-[100%] tracking-[-0.02em] lg:text-[40px]'>
            Latest from Sim
          </h1>
          <p className='max-w-[360px] font-[430] font-season text-[#F6F6F0]/50 text-sm leading-[150%] tracking-[0.02em] lg:text-base'>
            Announcements, insights, and guides for building AI agent workflows.
          </p>
        </div>
      </div>

      {/* Full-width top line */}
      <div className='mt-8 h-px w-full bg-[var(--landing-bg-elevated)]' />

      {/* Content area with vertical border rails */}
      <div className='mx-5 border-[var(--landing-bg-elevated)] border-x lg:mx-16'>
        {/* Featured posts */}
        {featured.length > 0 && (
          <>
            <div className='flex flex-col sm:flex-row'>
              {featured.map((p, index) => (
                <Link
                  key={p.slug}
                  href={`/blog/${p.slug}`}
                  className='group flex flex-1 flex-col gap-4 border-[var(--landing-bg-elevated)] border-t p-6 transition-colors first:border-t-0 hover:bg-[var(--landing-bg-elevated)] sm:border-t-0 sm:border-l sm:first:border-l-0'
                >
                  <div className='relative aspect-video w-full overflow-hidden rounded-[5px]'>
                    <img
                      src={p.ogImage}
                      alt={p.title}
                      className='h-full w-full object-cover'
                      loading={index < 3 ? 'eager' : 'lazy'}
                    />
                  </div>
                  <div className='flex flex-col gap-2'>
                    <span className='font-martian-mono text-[var(--landing-text-subtle)] text-xs uppercase tracking-[0.1em]'>
                      {new Date(p.date).toLocaleDateString('en-US', {
                        month: 'short',
                        year: '2-digit',
                      })}
                    </span>
                    <h3 className='font-[430] font-season text-lg text-white leading-tight tracking-[-0.01em]'>
                      {p.title}
                    </h3>
                    <p className='line-clamp-2 text-[#F6F6F0]/50 text-sm leading-[150%]'>
                      {p.description}
                    </p>
                  </div>
                </Link>
              ))}
            </div>

            <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
          </>
        )}

        {remaining.map((p) => (
          <div key={p.slug}>
            <Link
              href={`/blog/${p.slug}`}
              className='group flex items-start gap-6 px-6 py-6 transition-colors hover:bg-[var(--landing-bg-elevated)] md:items-center'
            >
              {/* Date */}
              <span className='hidden w-[120px] shrink-0 pt-1 font-martian-mono text-[var(--landing-text-subtle)] text-xs uppercase tracking-[0.1em] md:block'>
                {new Date(p.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>

              {/* Title + description */}
              <div className='flex min-w-0 flex-1 flex-col gap-1'>
                <span className='font-martian-mono text-[var(--landing-text-subtle)] text-xs uppercase tracking-[0.1em] md:hidden'>
                  {new Date(p.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                <h3 className='font-[430] font-season text-base text-white leading-tight tracking-[-0.01em] lg:text-lg'>
                  {p.title}
                </h3>
                <p className='line-clamp-2 text-[#F6F6F0]/40 text-sm leading-[150%]'>
                  {p.description}
                </p>
              </div>

              {/* Image */}
              <div className='hidden h-[80px] w-[140px] shrink-0 overflow-hidden rounded-[5px] sm:block'>
                <img
                  src={p.ogImage}
                  alt={p.title}
                  className='h-full w-full object-cover'
                  loading='lazy'
                />
              </div>
            </Link>
            <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
          </div>
        ))}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className='px-6 py-8'>
            <div className='flex items-center justify-center gap-3'>
              {pageNum > 1 && (
                <Link
                  href={`/blog?page=${pageNum - 1}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`}
                  className='rounded-[5px] border border-[var(--landing-border-strong)] px-3 py-1 text-[var(--landing-text)] text-sm transition-colors hover:bg-[var(--landing-bg-elevated)]'
                >
                  Previous
                </Link>
              )}
              <span className='text-[var(--landing-text-muted)] text-sm'>
                Page {pageNum} of {totalPages}
              </span>
              {pageNum < totalPages && (
                <Link
                  href={`/blog?page=${pageNum + 1}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`}
                  className='rounded-[5px] border border-[var(--landing-border-strong)] px-3 py-1 text-[var(--landing-text)] text-sm transition-colors hover:bg-[var(--landing-bg-elevated)]'
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Full-width bottom line — overlaps last inner divider to avoid double border */}
      <div className='-mt-px h-px w-full bg-[var(--landing-bg-elevated)]' />
    </section>
  )
}
