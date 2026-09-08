import { cn } from '@sim/emcn'
import type { Metadata } from 'next'
import { buildIndexMetadata } from '@/lib/content/seo'
import { CUSTOMER_SECTION, CUSTOMER_STORIES } from '@/lib/customers/data'
import { getAllCustomerStoryMeta, getCustomerStoryBySlug } from '@/lib/customers/registry'
import {
  HOME_INSET,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
  LANDING_HERO_TOP_PADDING,
} from '@/app/(landing)/components/landing-layout'
import { CustomerStoryCard } from '@/app/(landing)/customers/components/customer-story-card/customer-story-card'

export const revalidate = 86400

export async function generateMetadata(): Promise<Metadata> {
  const published = await getAllCustomerStoryMeta()
  return {
    ...buildIndexMetadata(CUSTOMER_SECTION, { pageNum: 1 }),
    ...(published.length === 0 ? { robots: { index: false, follow: false } } : {}),
  }
}

export default async function Page() {
  const published = await getAllCustomerStoryMeta()
  const visibleStories =
    published.length === 0
      ? CUSTOMER_STORIES
      : CUSTOMER_STORIES.filter((story) => published.some((post) => post.slug === story.slug))
  const stories = await Promise.all(
    visibleStories.map(async (story) => ({
      story,
      post: await getCustomerStoryBySlug(story.slug),
    }))
  )
  return (
    <main id='main-content' className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
      <div className={HOME_INSET}>
        <header className={cn('pb-16 max-sm:pb-10', LANDING_HERO_TOP_PADDING)}>
          <p className='mb-6 text-[14px] text-[var(--text-secondary)]'>Customer stories</p>
          <h1 className='max-w-[850px] text-balance text-[64px] leading-[1.04] tracking-[-0.03em] max-sm:text-[36px] max-xl:text-[52px]'>
            The teams building their future with Sim.
          </h1>
          <p className='mt-6 max-w-[600px] text-[20px] text-[var(--text-secondary)] leading-[1.4] max-sm:text-[17px]'>
            {CUSTOMER_SECTION.description}
          </p>
        </header>
        <section
          aria-labelledby='customer-stories-heading'
          className='grid grid-cols-2 gap-x-8 gap-y-12 max-md:grid-cols-1'
        >
          <h2 id='customer-stories-heading' className='sr-only'>
            Featured customer stories
          </h2>
          {stories.map(({ story, post }) =>
            post ? <CustomerStoryCard key={story.slug} story={story} post={post} /> : null
          )}
        </section>
      </div>
    </main>
  )
}
