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

/** Grid of post cards (cover, date, title, description) linking to other posts in a content section. */
export function ContentRelatedPosts({
  basePath,
  posts,
  label = 'Related posts',
}: ContentRelatedPostsProps) {
  return (
    <nav aria-label={label} className='overflow-hidden'>
      <div className='-mt-px -ml-px grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'>
        {posts.map((p) => (
          <Link
            key={p.slug}
            href={`${basePath}/${p.slug}`}
            className='group flex flex-col gap-4 border-[var(--border)] border-t border-l p-6 transition-colors hover-hover:bg-[var(--surface-hover)]'
          >
            <div className='relative aspect-video w-full overflow-hidden rounded-[5px]'>
              <Image
                src={p.ogImage}
                alt={p.title}
                fill
                sizes='(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 33vw'
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
      </div>
    </nav>
  )
}
