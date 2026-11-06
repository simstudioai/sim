import Link from 'next/link'
import type { ContentMeta } from '@/lib/content/schema'
import { ChevronArrow } from '@/app/(landing)/components/chevron-arrow'
import { formatPostDate } from '@/app/(landing)/components/content-utils'

interface ContentBacklinksProps {
  /** Route base path of the posts' section, e.g. `/library`. */
  basePath: string
  /** Posts whose body links to the current post. */
  posts: ContentMeta[]
}

/** "Referenced in" list linking a post to the posts that cite it. */
export function ContentBacklinks({ basePath, posts }: ContentBacklinksProps) {
  return (
    <section aria-labelledby='backlinks-heading'>
      <h2
        id='backlinks-heading'
        className='mb-4 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em] lg:text-2xl'
      >
        Referenced in
      </h2>
      <ul className='divide-y divide-[var(--border)] border-[var(--border)] border-y'>
        {posts.map((post) => (
          <li key={post.slug}>
            <Link
              href={`${basePath}/${post.slug}`}
              className='group/link flex items-center gap-4 px-6 py-4 transition-colors hover-hover:bg-[var(--surface-hover)]'
            >
              <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                <h3 className='text-[var(--text-primary)] text-sm leading-snug tracking-[-0.02em]'>
                  {post.title}
                </h3>
                <time
                  dateTime={post.date}
                  className='text-[var(--text-muted)] text-caption leading-[150%]'
                >
                  {formatPostDate(post.date)}
                </time>
              </div>
              <ChevronArrow />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
