import { cn } from '@sim/emcn'
import Image from 'next/image'
import { LOGOS, MUTED_MARK } from '@/app/(landing)/components/logos'
import styles from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-logo-marquee/nav-menu-logo-marquee.module.css'

/**
 * The track holds two identical copies of the row and slides by half its
 * width per cycle, so the seam lands exactly where the next copy begins and
 * the loop never visibly restarts. Every copy is bounded to keep the cadence
 * even: a copy is about 800px, so 16s is roughly 50px/s.
 */
const COPIES = [0, 1] as const
const TRACK_MOTION = styles.track
const EDGE_FADE =
  '[mask-image:linear-gradient(to_right,transparent,black_14%,black_86%,transparent)]'
const LABEL = 'Companies building and governing AI agents with Sim'

/**
 * The customer wordmarks sliding in a muted band under a floating menu's
 * blocs - the homepage's shared logo set at its optical sizes, the way the
 * platform pages show them. The second copy of the row exists only for the
 * seamless loop and is hidden from assistive technology; a reduced-motion
 * preference leaves the row still.
 */
export function NavMenuLogoMarquee() {
  return (
    <div className={cn('overflow-hidden py-2', EDGE_FADE)}>
      <div
        className={cn(
          'flex w-max items-center will-change-transform [backface-visibility:hidden]',
          TRACK_MOTION
        )}
      >
        {COPIES.map((copy) => {
          const decorative = copy > 0
          return (
            <ul
              key={copy}
              aria-hidden={decorative || undefined}
              aria-label={decorative ? undefined : LABEL}
              className='flex w-max items-center'
            >
              {LOGOS.map((logo) => (
                <li key={logo.name} className='flex shrink-0 items-center px-6'>
                  <Image
                    src={logo.src}
                    alt={decorative ? '' : logo.name}
                    height={logo.height}
                    width={Math.round(logo.height * logo.aspect)}
                    loading='lazy'
                    draggable={false}
                    className={MUTED_MARK}
                  />
                </li>
              ))}
            </ul>
          )
        })}
      </div>
    </div>
  )
}
