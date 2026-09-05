import { cn } from '@sim/emcn'
import {
  HOME_INSET,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
} from '@/app/(landing)/components/landing-layout'
import { Logos } from '@/app/(landing)/components/logos'

/** Homepage customer logos between the hero preview and featured customer film. */
export function Proof() {
  return (
    <section
      id='proof'
      aria-label='Customer logos'
      className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}
    >
      <div className={cn(HOME_INSET, 'flex justify-center')}>
        <Logos layout='row' size='proof' tone='muted' />
      </div>
    </section>
  )
}
