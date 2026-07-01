import { ChipLink } from '@sim/emcn'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getAllPostMeta } from '@/lib/blog/registry'
import { buildCollectionPageJsonLd } from '@/lib/blog/seo'
import { SITE_URL } from '@/lib/core/utils/urls'
import { JsonLd } from '@/app/(landing)/components/json-ld'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tag?: string }>
}): Promise<Metadata> {
  const { page, tag } = await searchParams
  const pageNum = Math.max(1, Number(page || 1))

  const titleParts = ['Blog']
  if (tag) titleParts.push(tag)
  if (pageNum > 1) titleParts.push(`Page ${pageNum}`)
  const title = titleParts.join(' | ')

  const description = tag
    ? `Sim blog posts tagged "${tag}": insights and guides for building AI agents.`
    : 'Announcements, insights, and guides from Sim, the open-source AI workspace, for building, deploying, and managing AI agents.'

  const canonicalParams = new URLSearchParams()
  if (tag) canonicalParams.set('tag', tag)
  if (pageNum > 1) canonicalParams.set('page', String(pageNum))
  const qs = canonicalParams.toString()
  const canonical = `${SITE_URL}/blog${qs ? `?${qs}` : ''}`

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${title} | Sim`,
      description,
      url: canonical,
      siteName: 'Sim',
      locale: 'en_US',
      type: 'website',
      images: [
        {
          url: `${SITE_URL}/logo/primary/medium.png`,
          width: 1200,
          height: 630,
          alt: 'Sim Blog',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | Sim`,
      description,
      site: '@simdotai',
    },
  }
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

  const collectionJsonLd = buildCollectionPageJsonLd()

  return (
    <section className='bg-[var(--bg)]'>
      <JsonLd data={collectionJsonLd} />

      {/* Section header */}
      <div className='mx-auto w-full max-w-[1446px] px-12 pt-[112px] max-sm:px-5 max-sm:pt-20 max-lg:px-8'>
        <div className='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
          <h1 className='text-balance text-[28px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[40px]'>
            Latest from Sim
          </h1>
          <p className='max-w-[540px] text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em] lg:text-base'>
            Announcements, insights, and guides for building AI agents.
          </p>
        </div>
      </div>

      {/* Full-width top line */}
      <div className='mt-8 h-px w-full bg-[var(--border)]' />

      {/* Content area with vertical border rails */}
      <div className='mx-auto w-full max-w-[1446px] px-12 max-sm:px-5 max-lg:px-8'>
        <div className='border-[var(--border)] border-x'>
          {/* Featured posts */}
          {featured.length > 0 && (
            <>
              <nav aria-label='Featured posts' className='flex flex-col sm:flex-row'>
                {featured.map((p, index) => (
                  <Link
                    key={p.slug}
                    href={`/blog/${p.slug}`}
                    className='group flex flex-1 flex-col gap-4 border-[var(--border)] border-t p-6 transition-colors first:border-t-0 hover:bg-[var(--surface-hover)] sm:border-t-0 sm:border-l sm:first:border-l-0'
                  >
                    <div className='relative aspect-video w-full overflow-hidden rounded-[5px]'>
                      <Image
                        src={p.ogImage}
                        alt={p.title}
                        fill
                        sizes='(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw'
                        className='object-cover'
                        priority={index < 3}
                        unoptimized
                      />
                    </div>
                    <div className='flex flex-col gap-2'>
                      <span className='text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'>
                        {new Date(p.date).toLocaleDateString('en-US', {
                          month: 'short',
                          year: '2-digit',
                        })}
                      </span>
                      <h3 className='text-[var(--text-primary)] text-lg leading-tight tracking-[-0.01em]'>
                        {p.title}
                      </h3>
                      <p className='line-clamp-2 text-[var(--text-muted)] text-sm leading-[150%]'>
                        {p.description}
                      </p>
                    </div>
                  </Link>
                ))}
              </nav>

              <div className='h-px w-full bg-[var(--border)]' />
            </>
          )}

          {remaining.map((p) => (
            <div key={p.slug}>
              <Link
                href={`/blog/${p.slug}`}
                className='group flex items-start gap-6 p-6 transition-colors hover:bg-[var(--surface-hover)] md:items-center'
              >
                {/* Date */}
                <span className='hidden w-[120px] shrink-0 pt-1 text-[var(--text-muted)] text-xs uppercase tracking-[0.1em] md:block'>
                  {new Date(p.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>

                {/* Title + description */}
                <div className='flex min-w-0 flex-1 flex-col gap-1'>
                  <span className='text-[var(--text-muted)] text-xs uppercase tracking-[0.1em] md:hidden'>
                    {new Date(p.date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                  <h3 className='text-[var(--text-primary)] text-base leading-tight tracking-[-0.01em] lg:text-lg'>
                    {p.title}
                  </h3>
                  <p className='line-clamp-2 text-[var(--text-muted)] text-sm leading-[150%]'>
                    {p.description}
                  </p>
                </div>

                {/* Image */}
                <div className='relative hidden h-[80px] w-[140px] shrink-0 overflow-hidden rounded-[5px] sm:block'>
                  <Image
                    src={p.ogImage}
                    alt={p.title}
                    fill
                    sizes='140px'
                    className='object-cover'
                    unoptimized
                  />
                </div>
              </Link>
              <div className='h-px w-full bg-[var(--border)]' />
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <nav aria-label='Pagination' className='px-6 py-8'>
              <div className='flex items-center justify-center gap-3'>
                {pageNum > 1 && (
                  <ChipLink
                    href={`/blog?page=${pageNum - 1}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`}
                    rel='prev'
                    className='border border-[var(--border-1)]'
                  >
                    Previous
                  </ChipLink>
                )}
                <span className='text-[var(--text-muted)] text-sm'>
                  Page {pageNum} of {totalPages}
                </span>
                {pageNum < totalPages && (
                  <ChipLink
                    href={`/blog?page=${pageNum + 1}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`}
                    rel='next'
                    className='border border-[var(--border-1)]'
                  >
                    Next
                  </ChipLink>
                )}
              </div>
            </nav>
          )}
        </div>
      </div>

      {/* Full-width bottom line - overlaps last inner divider to avoid double border */}
      <div className='-mt-px h-px w-full bg-[var(--border)]' />
    </section>
  )
}
