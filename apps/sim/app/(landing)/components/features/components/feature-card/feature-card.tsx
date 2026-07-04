import type { ReactNode } from 'react'
import { ChipTag, cn } from '@sim/emcn'
import { ArrowRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

interface FeatureCardProps {
  /** Capability name shown as a chip tag pinned to the card's top-right corner. */
  eyebrow: string
  /** The beat's headline (`<h3>` - the section owns the single `<h2>`). */
  title: string
  /** Supporting copy beneath the headline. */
  description: string
  /** Optional trailing link (e.g. the feature's platform page). */
  href?: string
  /** Label for {@link href}. */
  linkLabel?: string
  /** Backdrop image under the floating callout (public path). */
  backdropSrc: string
  /**
   * Which side the media stage sits on from `lg` up (cards alternate down the
   * section, Cursor-style). Below `lg` the card always stacks media-first.
   */
  mediaSide?: 'left' | 'right'
  /**
   * Square the card's bottom corners so its bottom edge merges with a
   * full-bleed divider drawn at the same line (the section's last card).
   */
  flushBottom?: boolean
  /** The elevated real-UI callout floating over the backdrop. */
  children: ReactNode
}

/**
 * Cursor-style feature card - one large OUTLINED container (a light
 * `--border` hairline on a transparent ground, no grey fill) holding a media
 * stage (a painted backdrop with the beat's real-UI callout floating over it)
 * and a vertically-centered copy column: `<h3>`, muted description, and an
 * optional arrow link. `mediaSide` picks which side the media sits on so the
 * cards can alternate down the section. The beat's name sits as a borderless
 * grey-filled {@link ChipTag} pinned to the card's top corner on the COPY
 * side (top-right when media is left, top-left when media is right), just
 * inside the outline - never floating over the media image.
 *
 * Below `lg` the card stacks - media on top, copy beneath - and the media
 * shortens so the card stays scannable in the compact grid.
 */
export function FeatureCard({
  eyebrow,
  title,
  description,
  href,
  linkLabel,
  backdropSrc,
  mediaSide = 'left',
  flushBottom = false,
  children,
}: FeatureCardProps) {
  const mediaRight = mediaSide === 'right'
  return (
    <article
      className={cn(
        'relative grid gap-10 rounded-[10px] border border-[var(--border)] p-4 max-lg:grid-cols-1 max-lg:gap-6',
        mediaRight ? 'grid-cols-[386px_1fr]' : 'grid-cols-[1fr_386px]',
        flushBottom && 'rounded-b-none'
      )}
    >
      <ChipTag
        variant='mono'
        className={cn('absolute top-4 z-10', mediaRight ? 'left-4' : 'right-4')}
      >
        {eyebrow}
      </ChipTag>
      <div
        aria-hidden='true'
        className={cn(
          'relative h-[650px] overflow-hidden rounded-[4px] max-sm:h-[280px] max-lg:order-1 max-lg:h-[360px]',
          mediaRight && 'lg:order-2'
        )}
      >
        <Image
          src={backdropSrc}
          alt=''
          fill
          sizes='(max-width: 1460px) 70vw, 900px'
          className='object-cover'
        />
        <div className='absolute inset-0 flex items-center justify-center p-4 [&>*]:max-w-full'>
          {children}
        </div>
      </div>

      <div
        className={cn(
          'flex flex-col justify-center max-lg:order-2 max-lg:pb-2',
          mediaRight ? 'pl-4 max-lg:pl-0' : 'pr-4 max-lg:pr-0'
        )}
      >
        <h3 className='text-balance font-medium text-[22px] text-[var(--text-primary)] leading-[1.3] max-sm:text-[20px]'>
          {title}
        </h3>
        <p className='mt-3 text-pretty text-[15px] text-[var(--text-muted)] leading-[1.6]'>
          {description}
        </p>
        {href && linkLabel && (
          <Link
            href={href}
            className='mt-5 flex items-center gap-1.5 text-[15px] text-[var(--text-body)] transition-colors hover-hover:text-[var(--text-primary)]'
          >
            {linkLabel}
            <ArrowRight className='size-[15px]' />
          </Link>
        )}
      </div>
    </article>
  )
}
