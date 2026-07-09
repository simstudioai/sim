import Image from 'next/image'
import Link from 'next/link'
import type { ContentMeta } from '@/lib/content/schema'
import { JsonLd } from '@/app/(landing)/components/json-ld'

interface ContentAuthorPageProps {
  /** Route base path, e.g. `/blog` or `/library`. */
  basePath: string
  authorName?: string
  authorAvatarUrl?: string
  /** Posts already filtered down to this author. */
  posts: ContentMeta[]
  graphJsonLd?: Record<string, unknown>
}

/** Shared author-profile layout for a content section. */
export function ContentAuthorPage({
  basePath,
  authorName,
  authorAvatarUrl,
  posts,
  graphJsonLd,
}: ContentAuthorPageProps) {
  if (!authorName) {
    return (
      <main className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
        <h1 className='text-[32px] text-[var(--text-primary)]'>Author not found</h1>
      </main>
    )
  }

  return (
    <main className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
      {graphJsonLd && <JsonLd data={graphJsonLd} />}
      <div className='mb-6 flex items-center gap-3'>
        {authorAvatarUrl ? (
          <Image
            src={authorAvatarUrl}
            alt={authorName}
            width={40}
            height={40}
            className='rounded-full'
            unoptimized
          />
        ) : null}
        <h1 className='text-[32px] text-[var(--text-primary)] leading-tight'>{authorName}</h1>
      </div>
      <div className='grid grid-cols-1 gap-8 sm:grid-cols-2'>
        {posts.map((p) => (
          <Link key={p.slug} href={`${basePath}/${p.slug}`} className='group'>
            <div className='overflow-hidden rounded-lg border border-[var(--border)]'>
              <Image
                src={p.ogImage}
                alt={p.title}
                width={600}
                height={315}
                className='h-[160px] w-full object-cover transition-transform group-hover:scale-[1.02]'
              />
              <div className='p-3'>
                <div className='mb-1 text-[var(--text-muted)] text-xs'>
                  {new Date(p.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
                <div className='text-[var(--text-primary)] text-sm leading-tight'>{p.title}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  )
}
