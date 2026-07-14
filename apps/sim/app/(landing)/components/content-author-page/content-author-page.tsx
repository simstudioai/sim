import { ChipLink } from '@sim/emcn'
import Image from 'next/image'
import Link from 'next/link'
import type { ContentMeta } from '@/lib/content/schema'
import { BackLink } from '@/app/(landing)/components/back-link'
import { Cta } from '@/app/(landing)/components/cta/cta'
import { JsonLd } from '@/app/(landing)/components/json-ld'

interface ContentAuthorPageProps {
  /** Route base path, e.g. `/blog` or `/library`. */
  basePath: string
  /** Section label used in the not-found fallback, e.g. "Blog" or "Library". */
  sectionName: string
  authorName?: string
  authorAvatarUrl?: string
  /** Posts already filtered down to this author. */
  posts: ContentMeta[]
  graphJsonLd?: Record<string, unknown>
}

/**
 * Shared author-profile layout for a content section: standard page-shell
 * header (matching `ContentIndexPage`/`ContentPostPage`) with avatar + name,
 * followed by the author's posts in the same framed-list card style used
 * everywhere else on the site.
 */
export function ContentAuthorPage({
  basePath,
  sectionName,
  authorName,
  authorAvatarUrl,
  posts,
  graphJsonLd,
}: ContentAuthorPageProps) {
  if (!authorName) {
    return (
      <section className='mx-auto flex min-h-[60vh] w-full max-w-[1446px] flex-col items-center justify-center gap-3 px-12 py-24 text-center max-sm:px-5 max-lg:px-8'>
        <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
          Author not found
        </h1>
        <p className='text-[var(--text-muted)] text-lg'>
          The author you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <ChipLink variant='primary' href={basePath} className='mt-3'>
          Browse {sectionName}
        </ChipLink>
      </section>
    )
  }

  return (
    <>
      <section className='bg-[var(--bg)]'>
        {graphJsonLd && <JsonLd data={graphJsonLd} />}

        <div className='mx-auto w-full max-w-[1460px] px-20 pt-[112px] max-sm:px-5 max-sm:pt-20 max-lg:px-8'>
          <div className='mb-6'>
            <BackLink href={basePath} label={`Back to ${sectionName}`} />
          </div>

          <div className='flex items-center gap-4'>
            {authorAvatarUrl ? (
              <Image
                src={authorAvatarUrl}
                alt={authorName}
                width={64}
                height={64}
                className='rounded-full'
                unoptimized
              />
            ) : null}
            <h1 className='text-balance text-[28px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[40px]'>
              {authorName}
            </h1>
          </div>
        </div>

        <div className='mt-8 h-px w-full bg-[var(--border)]' />

        <div className='mx-auto w-full max-w-[1460px] px-20 max-sm:px-5 max-lg:px-8'>
          <div className='border-[var(--border)] border-x'>
            {posts.map((p) => (
              <div key={p.slug}>
                <Link
                  href={`${basePath}/${p.slug}`}
                  className='group flex items-start gap-6 p-6 transition-colors hover:bg-[var(--surface-hover)] md:items-center'
                >
                  <span className='hidden w-[120px] shrink-0 pt-1 text-[var(--text-muted)] text-xs uppercase tracking-[0.1em] md:block'>
                    {new Date(p.date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>

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
          </div>
        </div>

        <div className='-mt-px h-px w-full bg-[var(--border)]' />
      </section>

      <div className='mt-[120px] max-sm:mt-16 max-lg:mt-[88px]'>
        <Cta />
      </div>
    </>
  )
}
