import { cn } from '@sim/emcn'
import Image from 'next/image'
import type { ContentPost } from '@/lib/content/schema'
import type { CustomerStory } from '@/lib/customers/data'
import { BackLink } from '@/app/(landing)/components/back-link/back-link'
import {
  HOME_INSET,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
  LANDING_HERO_TOP_PADDING,
} from '@/app/(landing)/components/landing-layout'
import { ShareButton } from '@/app/(landing)/components/share-button/share-button'
import { CustomerStoryCard } from '@/app/(landing)/customers/components/customer-story-card/customer-story-card'
import { CustomerStoryMedia } from '@/app/(landing)/customers/components/customer-story-media/customer-story-media'

interface CustomerStoryPageProps {
  story: CustomerStory
  post: ContentPost
  nextStory?: { story: CustomerStory; post: ContentPost }
}

/** Editorial customer detail with a 10/12 inset hero and a narrower reading column. */
export function CustomerStoryPage({ story, post, nextStory }: CustomerStoryPageProps) {
  const Article = post.Content

  return (
    <main id='main-content' className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
      <article className={HOME_INSET}>
        <header className={cn('pb-12 max-sm:pb-8', LANDING_HERO_TOP_PADDING)}>
          <BackLink href='/customers' label='Customer stories' />
          <h1 className='mt-7 max-w-[1100px] text-balance text-[64px] text-[var(--text-primary)] leading-[1.04] tracking-[-0.03em] max-sm:mt-5 max-sm:text-[36px] max-xl:text-[52px]'>
            {post.title}
          </h1>
        </header>

        <CustomerStoryMedia story={story} priority />

        <div className='grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.7fr)] items-start gap-20 pt-16 max-md:grid-cols-1 max-md:gap-10 max-md:pt-10 max-lg:gap-12'>
          <aside
            aria-label='About this customer'
            className='sticky top-[120px] min-w-0 max-md:static'
          >
            <dl className='space-y-8 max-md:grid max-md:grid-cols-2 max-md:gap-6 max-md:space-y-0'>
              <div className='max-md:col-span-2'>
                <dt className='mb-5 text-[13px] text-[var(--text-muted)]'>Customer</dt>
                <dd>
                  <Image
                    src={story.logo.src}
                    alt={story.logo.alt}
                    width={story.logo.width}
                    height={story.logo.height}
                    className='h-auto max-w-full brightness-0 dark:invert'
                  />
                </dd>
              </div>
              <div>
                <dt className='mb-2 text-[13px] text-[var(--text-muted)]'>Industry</dt>
                <dd className='text-[15px] text-[var(--text-primary)]'>{story.industry}</dd>
              </div>
              <div>
                <dt className='mb-2 text-[13px] text-[var(--text-muted)]'>Focus</dt>
                <dd className='space-y-1 text-[15px] text-[var(--text-body)]'>
                  {story.focus.map((focus) => (
                    <p key={focus}>{focus}</p>
                  ))}
                </dd>
              </div>
            </dl>
            <div className='mt-8 border-[var(--border)] border-t pt-6'>
              <ShareButton url={post.canonical} title={post.title} />
            </div>
          </aside>

          <div className='min-w-0 max-w-[740px]'>
            <p className='mb-10 text-pretty text-[28px] text-[var(--text-primary)] leading-[1.3] tracking-[-0.015em] max-sm:text-[23px]'>
              {post.description}
            </p>
            <div className='[&_h2:first-child]:!mt-0 [&_:is(h1,h2,h3,h4,h5,h6,a,strong,b)]:font-normal [&_h2]:scroll-mt-28 [&_p]:text-pretty'>
              <Article />
            </div>
          </div>
        </div>
      </article>

      {nextStory && (
        <section
          aria-labelledby='more-customer-stories'
          className={cn('mt-24 border-[var(--border)] border-t pt-10 max-sm:mt-16', HOME_INSET)}
        >
          <div className='mb-8 flex items-center justify-between gap-6'>
            <h2 id='more-customer-stories' className='text-[28px] leading-tight tracking-[-0.02em]'>
              More customer stories
            </h2>
            <BackLink href='/customers' label='All stories' />
          </div>
          <div className='max-w-[640px]'>
            <CustomerStoryCard story={nextStory.story} post={nextStory.post} />
          </div>
        </section>
      )}
    </main>
  )
}
