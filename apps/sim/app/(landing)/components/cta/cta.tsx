import { cn } from '@sim/emcn'
import Image from 'next/image'
import styles from '@/app/(landing)/components/cta/cta.module.css'
import { FOOTER_ARTWORK } from '@/app/(landing)/components/cta/footer-artwork.generated'
import { HeroCta } from '@/app/(landing)/components/hero-cta'
import {
  HOME_TYPE,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
} from '@/app/(landing)/components/landing-layout'

/** One shared closing statement, with a deliberate line break between sentences. */
const CTA_HEADLINE = ['Every agent your company runs.', 'All in one place.'] as const
const ARTWORK_SIZES = '(max-width: 639px) 112vw, 100vw'

/**
 * Painted pre-footer CTA for every marketing page, mounted once by LandingShell.
 * Theme classes select the matching lazy-loaded painting without client state.
 * Pre-encoded sources avoid request-time image optimization at every resolution.
 * An embedded preview fills the scene while the full-resolution image loads.
 * The sky mask keeps the copy clear and the lower edge fades into the footer.
 */
export function Cta() {
  return (
    <section
      id='cta'
      aria-labelledby='cta-heading'
      className='relative isolate flex w-full flex-col'
    >
      <div
        className={cn(
          'relative z-10 flex flex-col items-center gap-8 pt-10 text-center max-sm:gap-7 max-sm:pt-6 max-lg:pt-8',
          LANDING_CONTENT_WIDTH,
          LANDING_GUTTER
        )}
      >
        <h2
          id='cta-heading'
          className={cn('text-balance text-[var(--text-primary)]', HOME_TYPE.h2Display)}
        >
          {CTA_HEADLINE.map((line) => (
            <span key={line} className='block'>
              {line}{' '}
            </span>
          ))}
        </h2>
        <div className='max-sm:w-full'>
          <HeroCta size='display' secondaryLabel='Start building' trackingSection='footer_cta' />
        </div>
      </div>

      <div
        aria-hidden='true'
        className='-mt-[clamp(96px,12.5vw,240px)] max-sm:-mt-6 pointer-events-none relative aspect-video w-full max-sm:aspect-[16/10]'
      >
        {Object.entries(FOOTER_ARTWORK).map(([theme, artwork]) => (
          <picture
            key={theme}
            className={cn(
              'absolute inset-0',
              theme === 'light' ? 'block dark:hidden' : 'hidden dark:block'
            )}
          >
            <source type='image/avif' srcSet={artwork.avifSrcSet} sizes={ARTWORK_SIZES} />
            <source type='image/webp' srcSet={artwork.webpSrcSet} sizes={ARTWORK_SIZES} />
            <Image
              src={artwork.src}
              alt=''
              fill
              unoptimized
              placeholder='blur'
              blurDataURL={artwork.blurDataURL}
              fetchPriority='high'
              sizes={ARTWORK_SIZES}
              className={cn('object-cover object-center', styles.plate)}
            />
          </picture>
        ))}
      </div>
    </section>
  )
}
