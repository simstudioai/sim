import { ChipLink, cn } from '@sim/emcn'

/**
 * Hero-scale sizing shared by both CTAs - one step up from the navbar's 30px
 * chip: 36px tall, 15px label (the chip's inner span inherits it), horizontal
 * padding in `em` at the chip's native 8/14 ratio so it scales with the text.
 */
const CTA_SIZE = 'h-[36px] px-[0.571em] text-[15px] [&>span]:[font-size:inherit]'

/**
 * The canonical landing call-to-action - a dark "Request a demo" chip beside an
 * outline "Sign up" chip. This is the single source of truth for the CTA used
 * by both the landing hero and every platform hero, so the two never drift.
 *
 * Both CTAs are the same global {@link ChipLink} chrome the navbar's auth
 * cluster uses - "Request a demo" is the `primary` (filled) variant like the
 * navbar's "Sign up"; "Sign up" here is the default chip with the
 * `--border-1` outline like the navbar's "Contact sales" - scaled up one step
 * via {@link CTA_SIZE} (the sanctioned size overrides; chrome stays the chip's).
 *
 * Server Component; owns its own internal spacing. Consumers place it in their
 * own stack and pass nothing.
 */
export function HeroCta() {
  return (
    <div className='flex items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch'>
      <ChipLink variant='primary' href='/demo' className={CTA_SIZE}>
        Request a demo
      </ChipLink>
      <ChipLink
        href='/signup'
        className={cn(CTA_SIZE, 'border border-[var(--border-1)] max-sm:justify-center')}
      >
        Sign up
      </ChipLink>
    </div>
  )
}
