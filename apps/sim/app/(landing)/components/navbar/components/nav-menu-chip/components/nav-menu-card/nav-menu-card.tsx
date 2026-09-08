import { cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import Image from 'next/image'
import Link from 'next/link'
import type { NavMenuItemData } from '@/app/(landing)/components/navbar/components/nav-menu-chip/types'

interface NavMenuCardProps {
  item: NavMenuItemData
  onSelect: () => void
  prefetch?: boolean | null
}

/**
 * Placement grounds standing in for real imagery. `dark` is the platform's
 * dark grey (its inverted hover surface) with the mark flattened to white;
 * `light` is its elevated light grey with the mark's own ink - flattened to
 * white too once that grey goes dark.
 */
const TONE = {
  dark: {
    ground:
      'border-transparent bg-[var(--surface-inverted-hover)] text-[var(--white)] hover:border-[var(--text-subtle)]',
    mark: 'brightness-0 invert',
  },
  light: {
    ground:
      'border-[var(--border)] bg-[var(--surface-6)] text-[var(--text-primary)] hover:border-[var(--text-subtle)]',
    mark: 'dark:brightness-0 dark:invert',
  },
} as const

const HOVER_LABEL = 'Customer story'

/**
 * The picture eases in a touch on hover, under a slight tint - a 20% black
 * scrim (the featured film's approach, an alpha no token carries) that
 * steadies the white mark on the scene's light sky without dimming it much.
 */
const PICTURE =
  'object-cover transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.03]'
const SCRIM = 'absolute inset-0 bg-black/20'

/**
 * One customer tile in a `floating` menu: the customer's mark centred on a
 * toned placement - or on the customer's picture under a slight tint - and a
 * "Customer story" arrow label that rises into the corner on hover or focus.
 * The whole tile is the link.
 */
export function NavMenuCard({ item, onSelect, prefetch }: NavMenuCardProps) {
  const { card } = item
  const tone = TONE[card?.tone ?? 'light']
  return (
    <Link
      href={item.href}
      prefetch={prefetch}
      onClick={onSelect}
      aria-label={`${item.title} customer story`}
      className={cn(
        'group relative flex h-[180px] min-w-0 items-center justify-center overflow-hidden rounded-lg border px-6 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-secondary)] focus-visible:outline-offset-2',
        tone.ground
      )}
    >
      {card?.background && (
        <>
          <Image
            src={card.background.src}
            alt=''
            fill
            sizes='292px'
            loading='lazy'
            className={PICTURE}
          />
          <span aria-hidden='true' className={SCRIM} />
        </>
      )}
      {card && (
        <Image
          src={card.imageSrc}
          alt={card.imageAlt}
          height={card.height}
          width={Math.round(card.height * card.aspect)}
          loading='lazy'
          className={cn('relative h-auto max-w-full', tone.mark)}
        />
      )}
      <span
        aria-hidden='true'
        className='pointer-events-none absolute bottom-3 left-3 flex translate-y-1 items-center gap-1 font-medium text-[13px] leading-5 opacity-0 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none'
      >
        {HOVER_LABEL}
        <ArrowRight className='size-[14px]' />
      </span>
    </Link>
  )
}
