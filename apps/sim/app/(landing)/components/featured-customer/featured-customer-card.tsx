import { ChipTag, cn } from '@sim/emcn'
import Image from 'next/image'
import { LANDING_STAGE_RADIUS } from '@/app/(landing)/components/landing-layout'

/** A customer wordmark from `/public/landing/logos`, sized like the logo strip sizes it: by optical height at its own aspect. */
export interface FeaturedCustomerLogo {
  src: string
  alt: string
  /** Intrinsic width ÷ height, so the mark scales without distortion. */
  aspect: number
  /** Display height in px, tuned by eye for the card. */
  height: number
}

export interface FeaturedCustomerStory {
  id: string
  company: string
  caption: string
  media: { kind: 'video'; poster: string; src: string; alt: string } | { kind: 'brand' }
  /** The customer's wordmark, shown under the editorial product caption. */
  logo: FeaturedCustomerLogo
}

/**
 * The wordmark assets are a single dark ink; over the film they are flattened
 * and inverted to white, then eased back to sit with the caption's tone.
 */
const LOGO_ON_FILM = 'brightness-0 invert opacity-80'

interface FeaturedCustomerCardProps {
  story: FeaturedCustomerStory
  active: boolean
  emphasized: boolean
}

/** Shared media and editorial caption treatment for each featured-customer slide. */
export function FeaturedCustomerCard({ story, active, emphasized }: FeaturedCustomerCardProps) {
  const isFilm = story.media.kind === 'video'

  return (
    <article
      aria-hidden={!active}
      className={cn(
        'relative isolate size-full overflow-hidden',
        isFilm ? 'bg-[var(--text-primary)]' : 'bg-[var(--surface-4)]',
        LANDING_STAGE_RADIUS
      )}
    >
      {story.media.kind === 'video' && (
        <>
          <Image
            src={story.media.poster}
            alt={story.media.alt}
            fill
            sizes='(max-width: 640px) 100vw, 1728px'
            quality={90}
            className='object-cover'
          />
          {active && (
            <video
              aria-hidden='true'
              autoPlay
              loop
              muted
              playsInline
              preload='metadata'
              poster={story.media.poster}
              src={story.media.src}
              tabIndex={-1}
              className='pointer-events-none absolute inset-0 size-full object-cover motion-reduce:hidden'
            />
          )}
          <div className='absolute inset-0 bg-[linear-gradient(135deg,rgba(0,0,0,0.68)_0%,rgba(0,0,0,0.3)_36%,rgba(0,0,0,0.08)_70%)]' />
        </>
      )}

      <div
        data-customer-story-content='true'
        className={cn(
          'relative z-10 flex h-full items-start p-12 transition-[opacity,transform] duration-500 ease-out motion-reduce:transform-none motion-reduce:transition-none max-sm:p-6 max-lg:p-8',
          emphasized
            ? cn('translate-y-0 opacity-100', active ? 'delay-150' : 'delay-0')
            : 'translate-y-2 opacity-40 delay-0'
        )}
      >
        <div className='max-w-[42rem]'>
          <ChipTag
            variant={isFilm ? 'brand' : 'gray'}
            brandColor='transparent'
            brandForeground='light'
            brandStrokeColor='rgba(255, 255, 255, 0.4)'
            className='h-6 rounded-full px-3 opacity-80'
          >
            Featured customer
          </ChipTag>
          <p
            className={cn(
              'mt-4 text-pretty text-[44px] leading-[1.08] tracking-[-0.025em] max-sm:text-[30px] max-xl:text-[38px]',
              isFilm ? 'text-white' : 'text-[var(--text-primary)]'
            )}
          >
            {story.caption}
          </p>
          <Image
            src={story.logo.src}
            alt={story.logo.alt}
            height={story.logo.height}
            width={Math.round(story.logo.height * story.logo.aspect)}
            className={cn(
              'mt-8 h-auto max-w-full',
              isFilm ? LOGO_ON_FILM : 'brightness-0 dark:invert'
            )}
          />
        </div>
      </div>
    </article>
  )
}
