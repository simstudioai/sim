import { ChipLink } from '@sim/emcn'
import Image from 'next/image'
import Link from 'next/link'
import { paginateContentPosts } from '@/lib/content/index-list'
import type { ContentMeta } from '@/lib/content/schema'
import { JsonLd } from '@/app/(landing)/components/json-ld'

interface ContentIndexPageProps {
  /** Route base path, e.g. `/blog` or `/library`. */
  basePath: string
  heading: string
  subheading: string
  /** All published posts for the section, unfiltered and unsorted. */
  posts: ContentMeta[]
  page: number
  tag?: string
  collectionJsonLd: Record<string, unknown>
}

/**
 * Shared index/list layout for a content section (blog or library): section
 * header, featured-post row, remaining posts list, and pagination. Both
 * sections render this exact layout, parameterized by `basePath` and copy —
 * see `.claude/rules/landing-seo-geo.md` for the filtered/paginated noindex
 * policy this pairs with (`buildIndexMetadata` in `@/lib/content/seo`).
 */
export function ContentIndexPage({
  basePath,
  heading,
  subheading,
  posts,
  page,
  tag,
  collectionJsonLd,
}: ContentIndexPageProps) {
  const { featured, remaining, totalPages } = paginateContentPosts(posts, { tag, page })

  const pageHref = (targetPage: number) =>
    `${basePath}?page=${targetPage}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`

  return (
    <>
      <section className='bg-[var(--bg)]'>
        <JsonLd data={collectionJsonLd} />

        <div className='mx-auto w-full max-w-[1728px] px-10 pt-[112px] max-sm:pt-20 max-md:px-7 max-lg:px-8 max-xl:px-9'>
          <div className='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
            <h1 className='text-balance text-[28px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[40px]'>
              {heading}
            </h1>
            <p className='max-w-[540px] text-[var(--text-secondary)] text-sm leading-[150%] tracking-[0.02em] lg:text-base'>
              {subheading}
            </p>
          </div>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--border)]' />

        <div className='mx-auto w-full max-w-[1728px] px-10 max-md:px-7 max-lg:px-8 max-xl:px-9'>
          <div className='border-[var(--border)] border-x'>
            {featured.length > 0 && (
              <>
                <nav aria-label='Featured posts' className='flex flex-col sm:flex-row'>
                  {featured.map((p, index) => (
                    <Link
                      key={p.slug}
                      href={`${basePath}/${p.slug}`}
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
                          fetchPriority={index === 0 ? 'high' : undefined}
                          unoptimized
                        />
                      </div>
                      <div className='flex flex-col gap-2'>
                        <span className='text-[var(--text-secondary)] text-xs uppercase tracking-[0.1em]'>
                          {new Date(p.date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            timeZone: 'UTC',
                          })}
                        </span>
                        <h2 className='text-[var(--text-primary)] text-lg leading-tight tracking-[-0.01em]'>
                          {p.title}
                        </h2>
                        <p className='line-clamp-2 text-[var(--text-secondary)] text-sm leading-[150%]'>
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
                  href={`${basePath}/${p.slug}`}
                  className='group flex items-start gap-6 p-6 transition-colors hover:bg-[var(--surface-hover)] md:items-center'
                >
                  <span className='hidden w-[120px] shrink-0 pt-1 text-[var(--text-secondary)] text-xs uppercase tracking-[0.1em] md:block'>
                    {new Date(p.date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </span>

                  <div className='flex min-w-0 flex-1 flex-col gap-1'>
                    <span className='text-[var(--text-secondary)] text-xs uppercase tracking-[0.1em] md:hidden'>
                      {new Date(p.date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </span>
                    <h2 className='text-[var(--text-primary)] text-base leading-tight tracking-[-0.01em] lg:text-lg lg:leading-7'>
                      {p.title}
                    </h2>
                    <p className='line-clamp-2 text-[var(--text-secondary)] text-sm leading-[150%]'>
                      {p.description}
                    </p>
                  </div>

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

            {totalPages > 1 && (
              <nav aria-label='Pagination' className='px-6 py-8'>
                <div className='flex items-center justify-center gap-3'>
                  {page > 1 && (
                    <ChipLink
                      href={pageHref(page - 1)}
                      rel='prev'
                      className='border border-[var(--border-1)]'
                    >
                      Previous
                    </ChipLink>
                  )}
                  <span className='text-[var(--text-secondary)] text-sm'>
                    Page {page} of {totalPages}
                  </span>
                  {page < totalPages && (
                    <ChipLink
                      href={pageHref(page + 1)}
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

        <div className='-mt-px h-px w-full bg-[var(--border)]' />
      </section>
    </>
  )
}
