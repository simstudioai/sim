import { Chip, ChipLink, cn } from '@sim/emcn'

/**
 * Shared label sizing for both CTAs - the single 16px font-size knob (overriding
 * the chip's `text-sm`) plus horizontal padding at the chip's 8/14 ratio, so the
 * "Book a demo" and "Sign up" labels stay proportional and never drift apart.
 */
const CTA_LABEL = 'px-[0.571em] text-[16px] [&>span]:[font-size:inherit]'

/**
 * The canonical landing call-to-action - a 360px email-capture bar with an
 * inset "Book a demo" action, beside a standalone "Sign up" chip. This is the
 * single source of truth for the CTA used by both the landing hero and every
 * platform hero, so the two never drift.
 *
 * The email bar is a no-background input shell - `border-[var(--border-1)]` (the
 * field border) - wrapping a transparent 16px `<input>` and the "Book a demo"
 * action `gap-2` apart; its `pl-3` text gutter and tighter `pr-[3px]` tuck that
 * button evenly into the right corner. Its radius is `rounded-lg` (8px, the navbar
 * chip radius); the inset `rounded-md` (6px) "Book a demo" chip echoes that curve,
 * tucked inside the 3px inset (a hair under the bar's 8px, so the corners don't cross).
 *
 * Both CTAs carry 16px labels via a single font-size knob (`text-[16px]` +
 * `[&>span]:[font-size:inherit]`, overriding the chip's hardcoded `text-sm`) and
 * horizontal padding in `em` so it stays proportional to the text -
 * `px-[0.571em]` (the chip's 8/14 padding ratio). "Book a demo" is `h-[32px]`; in
 * the `h-[40px]` bar - 38px inside its 1px border - it centers to an equal 3px inset
 * on top, bottom, and right (`pr-[3px]`); the standalone
 * "Sign up" is the default chip overridden to the bar's `border-[var(--border-1)]`
 * and `rounded-lg` at `h-[40px]` - so the two CTAs share one corner radius and
 * their borders line up exactly.
 *
 * Server Component - the email bar is a native `method='get'` form targeting
 * `/demo`, so submitting it navigates to `/demo?email=<typed address>` with zero
 * client JS; the demo page reads that `email` param to prefill its booking form.
 * Owns its own chrome and internal spacing; consumers place it in their own stack
 * and pass nothing.
 */
export function HeroCta() {
  return (
    <div className='flex items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch'>
      <form
        action='/demo'
        method='get'
        className='flex h-[40px] w-[360px] items-center gap-2 rounded-lg border border-[var(--border-1)] pr-[3px] pl-3 max-sm:w-full'
      >
        <input
          type='email'
          name='email'
          aria-label='Email address'
          placeholder='Email address'
          autoComplete='email'
          className='h-full min-w-0 flex-1 bg-transparent text-[16px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
        />
        <Chip
          type='submit'
          variant='primary'
          flush
          className={cn('h-[32px] rounded-md', CTA_LABEL)}
        >
          Book a demo
        </Chip>
      </form>
      <ChipLink
        href='/signup'
        flush
        className={cn(
          'h-[40px] rounded-lg border border-[var(--border-1)] max-sm:justify-center max-sm:[&>span]:flex-none',
          CTA_LABEL
        )}
      >
        Sign up
      </ChipLink>
    </div>
  )
}
