import { ArrowRight } from '@sim/emcn/icons'
import Link from 'next/link'
import type { ContentMeta } from '@/lib/content/schema'
import type { CustomerStory } from '@/lib/customers/data'
import { CustomerStoryMedia } from '@/app/(landing)/customers/components/customer-story-media/customer-story-media'

interface CustomerStoryCardProps {
  story: CustomerStory
  post: ContentMeta
}

/** A quiet editorial link shared by the customer index and next-story section. */
export function CustomerStoryCard({ story, post }: CustomerStoryCardProps) {
  return (
    <Link
      href={`/customers/${story.slug}`}
      className='group flex min-w-0 flex-col gap-5 rounded-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4'
    >
      <CustomerStoryMedia story={story} />
      <div className='flex items-start justify-between gap-6'>
        <div>
          <p className='mb-2 text-[14px] text-[var(--text-muted)]'>{story.company}</p>
          <h3 className='max-w-[36rem] text-balance text-[26px] text-[var(--text-primary)] leading-[1.2] tracking-[-0.02em] max-sm:text-[23px]'>
            {post.title}
          </h3>
        </div>
        <ArrowRight
          aria-hidden='true'
          className='mt-1 size-5 shrink-0 text-[var(--text-icon)] transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none'
        />
      </div>
    </Link>
  )
}
