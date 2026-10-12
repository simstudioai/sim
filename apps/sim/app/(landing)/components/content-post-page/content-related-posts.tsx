import Image from 'next/image'
import Link from 'next/link'
import type { ContentMeta } from '@/lib/content/schema'
import { formatPostDate } from '@/app/(landing)/components/content-utils'

interface ContentRelatedPostsProps {
  /** Route base path of the posts' section, e.g. `/blog` or `/library`. */
  basePath: string
  posts: ContentMeta[]
  /** Accessible name for the nav landmark. */
  label?: string
}

/** Row of post cards (cover, date, title, description) linking to other posts in a content section. */
export function ContentRelatedPosts({
  basePath,
  posts,
  label = 'Related posts',
}: ContentRelatedPostsProps) {
  return (
    <nav aria-label={label} className='flex flex-col sm:flex-row'>
      {posts.map((p) => (
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
              loading='lazy'
              unoptimized
            />
          </div>
          <div className='flex flex-col gap-2'>
            <span className='text-[var(--text-secondary)] text-xs uppercase tracking-[0.1em]'>
              {formatPostDate(p.date)}
            </span>
            <h3 className='text-[var(--text-primary)] text-lg leading-tight tracking-[-0.01em]'>
              {p.title}
            </h3>
            <p className='line-clamp-2 text-[var(--text-secondary)] text-sm leading-[150%]'>
              {p.description}
            </p>
          </div>
        </Link>
      ))}
    </nav>
  )
}
